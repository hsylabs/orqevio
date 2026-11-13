# Your copy of Orqevio

This repository deploys your own copy of [Orqevio](https://github.com/hsylabs/orqevio) to your Cloudflare account: a Worker with the web app, the API and MCP, a Durable Object with your SQLite database and an R2 bucket for attachments.

Every change to the main branch deploys automatically (Workers Builds).

## The first time

Open your Worker's address (`https://<name>.<your-subdomain>.workers.dev`) and enter the setup code you chose when you created the repository, along with your name. Orqevio gives you your access key: save it in your password manager.

## Updates

Every week, Dependabot opens a pull request if there's a new version of Orqevio (the `create-orqevio` package). When you merge it, your copy updates; your data, your access key and your vault are kept.

GitLab doesn't have Dependabot: update the `create-orqevio` version in `package.json` yourself, or use Renovate.

## If you lose your key

1. In the Cloudflare dashboard, go to **Workers & Pages → your Worker → Settings → Variables and Secrets** and give `SETUP_CODE` a new value (at least 12 letters or digits).
2. Open your copy, click **Lost your key?** and enter that code.

All sessions are signed out; your data and your vault stay as they are.

## What to leave alone

`wrangler.jsonc` only sets the name of the Worker and the name of the bucket: the rest of the configuration comes from the installed package, so updates arrive complete.
