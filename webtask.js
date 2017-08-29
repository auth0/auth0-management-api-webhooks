const tools = require('auth0-extension-express-tools');

const expressApp = require('./server');
const logger = require('./server/lib/logger');

const createServer = tools.createServer((config, storage) => {
  logger.info('Starting Management API Webhooks extension - Version:', process.env.CLIENT_VERSION);
  return expressApp(config, storage);
});

module.exports = (context, req, res) => {
  createServer(context, req, res);
};
