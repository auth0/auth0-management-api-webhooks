const nock = require('nock');
const expect = require('chai').expect;

const config = require('../../server/lib/config');
const processLogs = require('../../server/lib/processLogs');

const storageProvider = (data = { }) => {
  const storage = {
    data
  };
  storage.read = () => new Promise(resolve => resolve(storage.data));
  storage.write = obj => new Promise((resolve) => {
    storage.data = obj;
    resolve();
  });

  return storage;
};

describe('processLogs', () => {
  before(() => {
    const defaultConfig = {
      AUTH0_DOMAIN: 'test.auth0.com',
      AUTH0_CLIENT_ID: 'someclientid',
      AUTH0_CLIENT_SECRET: 'someclientsecret',
      WEBHOOK_URL: 'http://test.webhook.example.com',
      AUTH0_API_ENDPOINTS: 'user,test',
      SEND_AS_BATCH: true,
      BATCH_SIZE: 100
    };
    config.setProvider(key => defaultConfig[key], null);
  });

  it('shouldn`t do anything if not run by cron', (done) => {
    const route = processLogs(storageProvider());

    route({}, {}, () => {
      done();
    });
  });

  it('should send logs to fake webhook', (done) => {
    nock('https://test.auth0.com')
      .post('/oauth/token')
      .reply(200, { expires_in: 2000, access_token: 'token', id_token: 'id_token', ok: true });

    nock('https://test.auth0.com')
      .get('/api/v2/logs')
      .query(() => true)
      .reply(function() {
        const logs = [
          { _id: 0, date: new Date(), type: 'sapi', details: { request: { path: '/api/v2/users' } } },
          { _id: 1, date: new Date(), type: 'sapi', details: { request: { path: '/api/v2/test' } } },
          { _id: 2, date: new Date(), type: 'sapi', details: { request: { path: '/api/v2/users' } } },
          { _id: 3, date: new Date(), type: 'sapi', details: { request: { path: '/api/v2/test' } } },
          { _id: 4, date: new Date(), type: 'sapi', details: { request: { path: '/api/v2/else' } } }
        ];

        return [
          200,
          logs,
          {
            'x-ratelimit-limit': 50,
            'x-ratelimit-remaining': 49,
            'x-ratelimit-reset': 0
          }
        ];
      });

    nock('https://test.auth0.com')
      .get('/api/v2/logs')
      .query(() => true)
      .reply(200, {});

    let receivedLogs;

    nock('http://test.webhook.example.com')
      .post('/')
      .reply(function(path, body) {
        receivedLogs = body;
        return [ 200, {} ];
      });
    const route = processLogs(storageProvider());
    const req = {
      body: {
        schedule: true,
        state: 'active'
      }
    };

    const res = {
      json: (data) => {
        expect(receivedLogs.length).to.equal(4);
        expect(data.status.logsProcessed).to.equal(5);
        expect(data.status.checkpoint).to.equal(4);
        done();
      }
    };

    route(req, res);
  });
});
