# Auth0 webhooks

*Auth0 webhooks* allows you to enable webhooks for Auth0's Management API. It will go through the audit logs and call a webhook for specific events. This can address use cases like:

> I want to call my own API each time a user is created or updated.

> I want to deprovision users from other systems whenever they are deleted in Auth0.

## Hosting on Webtask.io

If you haven't configured Webtask on your machine run this first:

```bash
$ npm i -g wt-cli
$ wt init
```

> Requires at least node 0.10.40 - if you're running multiple version of node make sure to load the right version, e.g. "nvm use 0.10.40"

### Deploy as a Webtask Cron

To run it on a schedule (run every 5 minutes for example):

```
$ npm run build
$ wt cron schedule \
    --name auth0-webhooks \
    --secret AUTH0_DOMAIN="YOUR_AUTH0_DOMAIN" \
    --secret AUTH0_GLOBAL_CLIENT_ID="YOUR_AUTH0_GLOBAL_CLIENT_ID" \
    --secret AUTH0_GLOBAL_CLIENT_SECRET="YOUR_AUTH0_GLOBAL_CLIENT_SECRET" \
    --secret AUTH0_API_ENDPOINTS="users,connections" \
    --secret WEBHOOK_URL="http://my.webhook.url/something" \
    --secret WEBHOOK_CONCURRENT_CALLS="10" \
    --json \
    "*/5 * * * *" \
    dist/auth0-webhooks-1.1.0.js
```

> You can get your Global Client Id/Secret here: https://auth0.com/docs/api/v2

The following settings are optional:

 - `AUTH0_API_ENDPOINTS`: This allows you to filter specific API endpoints, comma delimited (eg: I'm only interested in events happening on the `users` endpoint)
 - `WEBHOOK_CONCURRENT_CALLS`: Defaults to 5, these are the maximum concurrent calls that will be made to your web hook

## How it works

This webtask will process the Auth0 audit logs. Calls to the Management API (v2) are logged there and will be picked up by the webtask. These will then optionally be filtered (eg: only calls to the `users` endpoint) and will then be sent to your Webhook URL (POST).

Note that, if the URL we are sending the events to is offline or is returning anything that is not 200 OK (eg: Internal Server Error) processing will stop and the batch of logs will be retried in the next run. This means 2 things:

 - Logs are sent at least once, so make sure your webhook is idempotent
 - Since we are concurrently sending events, you'll need to take into account that events for the same resource (eg. a user) might not arrive in the right order.

To test this you could easily setup an endpoint on `http://requestb.in/` and use that as a Webhook URL. This will allow you to see the Webtask in action:

## Issue Reporting

If you have found a bug or if you have a feature request, please report them at this repository issues section. Please do not report security vulnerabilities on the public GitHub issue tracker. The [Responsible Disclosure Program](https://auth0.com/whitehat) details the procedure for disclosing security issues.

## Author

[Auth0](auth0.com)

## What is Auth0?

Auth0 helps you to:

* Add authentication with [multiple authentication sources](https://docs.auth0.com/identityproviders), either social like **Google, Facebook, Microsoft Account, LinkedIn, GitHub, Twitter, Box, Salesforce, amont others**, or enterprise identity systems like **Windows Azure AD, Google Apps, Active Directory, ADFS or any SAML Identity Provider**.
* Add authentication through more traditional **[username/password databases](https://docs.auth0.com/mysql-connection-tutorial)**.
* Add support for **[linking different user accounts](https://docs.auth0.com/link-accounts)** with the same user.
* Support for generating signed [Json Web Tokens](https://docs.auth0.com/jwt) to call your APIs and **flow the user identity** securely.
* Analytics of how, when and where users are logging in.
* Pull data from other sources and add it to the user profile, through [JavaScript rules](https://docs.auth0.com/rules).

## Create a free Auth0 Account

1. Go to [Auth0](https://auth0.com) and click Sign Up.
2. Use Google, GitHub or Microsoft Account to login.

## License

This project is licensed under the MIT license. See the [LICENSE](LICENSE) file for more info.
