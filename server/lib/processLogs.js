const async = require('async');
const moment = require('moment');
const Request = require('request');
const loggingTools = require('auth0-log-extension-tools');

const config = require('./config');
const logger = require('./logger');

module.exports = storage =>
  (req, res, next) => {
    const wtBody = (req.webtaskContext && req.webtaskContext.body) || req.body || {};
    const wtHead = (req.webtaskContext && req.webtaskContext.headers) || {};
    const isCron = (wtBody.schedule && wtBody.state === 'active') || (wtHead.referer === 'https://manage.auth0.com/' && wtHead['if-none-match']);

    if (!isCron) {
      return next();
    }

    const url = config('WEBHOOK_URL');
    const batchMode = config('SEND_AS_BATCH') === true || config('SEND_AS_BATCH') === 'true';
    const concurrentCalls = parseInt(config('WEBHOOK_CONCURRENT_CALLS'), 10) || 5;

    const sendRequest = (data, callback) =>
      Request({
        method: 'POST',
        url: url,
        json: true,
        body: data
      }, (err, response, body) => {
        if (err || response.statusCode < 200 || response.statusCode >= 400) {
          return callback(err || body || response.statusCode);
        }

        return callback();
      });

    const callWebhook = (logs, callback) => {
      if (batchMode) {
        return sendRequest(logs, callback);
      }

      return async.eachLimit(logs, concurrentCalls, sendRequest, callback);
    };

    const onLogsReceived = (logs, callback) => {
      if (!logs || !logs.length) {
        return callback();
      }

      let endpointsFilter = config('AUTH0_API_ENDPOINTS').split(',');
      endpointsFilter = endpointsFilter.length > 0 && endpointsFilter[0] === '' ? [] : endpointsFilter;

      const requestMatchesFilter = (log) => {
        if (!endpointsFilter || !endpointsFilter.length) return true;
        return log.details.request && log.details.request.path &&
          endpointsFilter.some(filter =>
          log.details.request.path === `/api/v2/${filter}`
          || log.details.request.path.indexOf(`/api/v2/${filter}/`) >= 0);
      };

      const filteredLogs = logs
        .filter(requestMatchesFilter)
        .map(log => ({
          date: log.date,
          request: log.details.request,
          response: log.details.response
        }));

      if (!filteredLogs.length) {
        return callback();
      }

      logger.info(`${filteredLogs.length} logs found.`);
      logger.info(`Sending to '${url}' with ${concurrentCalls} concurrent calls.`);

      return callWebhook(filteredLogs, callback);
    };

    const slack = new loggingTools.reporters.SlackReporter({
      hook: config('SLACK_INCOMING_WEBHOOK_URL'),
      username: 'auth0-management-api-webhooks',
      title: 'Management Api Webhooks'
    });

    const options = {
      domain: config('AUTH0_DOMAIN'),
      clientId: config('AUTH0_CLIENT_ID'),
      clientSecret: config('AUTH0_CLIENT_SECRET'),
      batchSize: parseInt(config('BATCH_SIZE'), 10),
      startFrom: config('START_FROM'),
      logTypes: [ 'sapi', 'fapi' ]
    };

    if (!options.batchSize || options.batchSize > 100) {
      options.batchSize = 100;
    }

    const auth0logger = new loggingTools.LogsProcessor(storage, options);

    const sendDailyReport = (lastReportDate) => {
      const current = new Date();

      const end = current.getTime();
      const start = end - 86400000;
      auth0logger.getReport(start, end)
        .then(report => slack.send(report, report.checkpoint))
        .then(() => storage.read())
        .then((data) => {
          data.lastReportDate = lastReportDate;
          return storage.write(data);
        });
    };

    const checkReportTime = () => {
      storage.read()
        .then((data) => {
          const now = moment().format('DD-MM-YYYY');
          const reportTime = config('DAILY_REPORT_TIME') || 16;

          if (data.lastReportDate !== now && new Date().getHours() >= reportTime) {
            sendDailyReport(now);
          }
        });
    };

    return auth0logger
      .run(onLogsReceived)
      .then((result) => {
        if (result && result.status && result.status.error) {
          slack.send(result.status, result.checkpoint);
        } else if (config('SLACK_SEND_SUCCESS') === true || config('SLACK_SEND_SUCCESS') === 'true') {
          slack.send(result.status, result.checkpoint);
        }

        checkReportTime();
        res.json(result);
      })
      .catch((err) => {
        slack.send({ error: err, logsProcessed: 0 }, null);
        checkReportTime();
        next(err);
      });
  };
