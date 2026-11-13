# orqevio

Orqevio ready to deploy on your own Cloudflare account: the Worker bundle, the web app and the base Wrangler configuration.

You do not need to install this package yourself. Run:

```bash
npx create-orqevio
```

The installer signs you in to Cloudflare, deploys your copy (a Worker, a Durable Object with SQLite and an R2 bucket) and shows its address. See https://github.com/hsylabs/orqevio for details.
