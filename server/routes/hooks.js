const router = require('express').Router;
const tools = require('auth0-extension-tools');
const middlewares = require('auth0-extension-express-tools').middlewares;

const config = require('../lib/config');
const logger = require('../lib/logger');

module.exports = () => {
  const hooks = router();
  const hookValidator = middlewares
    .validateHookToken(config('AUTH0_DOMAIN'), config('WT_URL'), config('EXTENSION_SECRET'));

  hooks.use('/on-uninstall', hookValidator('/.extensions/on-uninstall'));

  hooks.delete('/on-uninstall', (req, res) => {
    const clientId = config('AUTH0_CLIENT_ID');
    const options = {
      domain: config('AUTH0_DOMAIN'),
      clientSecret: config('AUTH0_CLIENT_SECRET'),
      clientId
    };
    tools.managementApi.getClient(options)
      .then(auth0 => auth0.clients.delete({ client_id: clientId }))
      .then(() => {
        logger.debug(`Deleted client ${clientId}`);
        res.sendStatus(204);
      })
      .catch((err) => {
        logger.debug(`Error deleting client: ${clientId}`);
        logger.error(err);

        // Even if deleting fails, we need to be able to uninstall the extension.
        res.sendStatus(204);
      });
  });
  return hooks;
};
