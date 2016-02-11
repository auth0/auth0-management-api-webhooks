const Auth0   = require('auth0');
const request = require('superagent');
const async   = require('async');
const express = require('express');
const Webtask = require('webtask-tools');
const app     = express();

function lastLogCheckpoint(req, res) {
  let ctx               = req.webtaskContext;
  let required_settings = ['AUTH0_DOMAIN', 'AUTH0_GLOBAL_CLIENT_ID', 'AUTH0_GLOBAL_CLIENT_SECRET', 'WEBHOOK_URL'];
  let missing_settings  = required_settings.filter((setting) => !ctx.data[setting]);

  if (missing_settings.length) {
    return res.status(400).send({ message: 'Missing settings: ' + missing_settings.join(', ') });
  }

  // If this is a scheduled task, we'll get the last log checkpoint from the previous run and continue from there.
  req.webtaskContext.read('history', {}, function (err, data) {
    if (err && err.output.statusCode !== 404) return res.status(err.code).send(err);

    let startCheckpointId = typeof data === 'undefined' ? null : data.checkpointId;

    // Initialize the Auth0 client.
    const auth0 = new Auth0({
      domain:       ctx.data.AUTH0_DOMAIN,
      clientID:     ctx.data.AUTH0_GLOBAL_CLIENT_ID,
      clientSecret: ctx.data.AUTH0_GLOBAL_CLIENT_SECRET
    });

    // Start the process.
    async.waterfall([
      //// STEP 1: Getting access token
      (callback) => {
        console.log('STEP 1: Getting access token');

        auth0.getAccessToken((err) => {
          if (err) {
            console.log('Error authenticating:', err);
          }
          return callback(err);
        });
      },
      //// STEP 2: Downloading logs
      (callback) => {
        console.log('STEP 2: Downloading logs');

        const getLogs = (context) => {
          console.log(`Downloading logs from: ${context.checkpointId || 'Start'}.`);

          context.logs = context.logs || [];

          auth0.getLogs({ take: 200, from: context.checkpointId }, (err, logs) => {
            if (err) {
              return callback(err);
            }

            if (logs && logs.length) {
              logs.forEach((l) => context.logs.push(l));
              context.checkpointId = context.logs[context.logs.length - 1]._id;
              return setImmediate(() => getLogs(context));
            }

            console.log(`Total logs: ${context.logs.length}.`);

            return callback(null, context);
          });
        };

        getLogs({ checkpointId: startCheckpointId });
      },
      //// STEP 3: Filtering logs
      (context, callback) => {
        console.log('STEP 3: Filtering logs');

        const endpoints_filter = ctx.data.AUTH0_API_ENDPOINTS.split(',');
        const request_matches_filter = (log) => {
          if (!endpoints_filter || !endpoints_filter.length) return true;
          return log.details.request && log.details.request.path &&
            endpoints_filter.some(f =>
              log.details.request.path === `/api/v2/${f}`
                || log.details.request.path.indexOf(`/api/v2/${f}/`) >= 0);
        };

        context.logs = context.logs
          .filter(l => l.type === 'sapi' || l.type === 'fapi')
          .filter(request_matches_filter)
          .map(l => {
            return {
              date: l.date,
              request: l.details.request,
              response: l.details.response
            };
          });

        if (ctx.data.AUTH0_API_ENDPOINTS) {
          console.log(`Filtered logs on '${ctx.data.AUTH0_API_ENDPOINTS}': ${context.logs.length}.`);
        }
        callback(null, context);
      },
      //// STEP 4: Sending information
      (context, callback) => {
        console.log('STEP 4: Sending information');

        if (!context.logs.length) {
          return callback(null, context);
        }

        const url              = ctx.data.WEBHOOK_URL;
        const concurrent_calls = ctx.data.WEBHOOK_CONCURRENT_CALLS || 5;

        console.log(`Sending to '${url}' with ${concurrent_calls} concurrent calls.`);

        async.eachLimit(context.logs, concurrent_calls, (log, cb) => {
          request
            .post(url)
            .send(log)
            .set('Content-Type', 'application/json')
            .end((err, res) => {
              if (err) {
                console.log('Error sending request:', err);
                return cb(err);
              }

              if (!res.ok) {
                console.log('Unexpected response while sending request:', JSON.stringify(res.body));
                return cb(new Error('Unexpected response from webhook.'));
              }

              cb();
            });
        }, (err) => {
          if (err) {
            return callback(err);
          }

          console.log('Upload complete.');
          return callback(null, context);
        });
      }
    ], (err, context) => {
      if (err) {
        console.log('Job failed.');

        return req.webtaskContext.write('history', JSON.stringify({checkpointId: startCheckpointId}), {}, function (error) {
          if (error) return res.status(500).send(error);

          res.status(500).send({
            error: err
          });
        });
      }

      console.log('Job complete.');
      return req.webtaskContext.write('history', JSON.stringify({checkpointId: context.checkpointId, totalLogsProcessed: context.logs.length}), {}, function (error) {
        if (error) return res.status(500).send(error);

        res.sendStatus(200);
      });
    });
  });
}

app.get ('/', lastLogCheckpoint);
app.post('/', lastLogCheckpoint);


module.exports = Webtask.fromExpress(app);
