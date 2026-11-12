import type { BaseConfig } from './config'
import { parseJsonc } from './jsonc'

/**
 * Files of the "Deploy to Cloudflare" template (templates/cloudflare) that are
 * derived from the monorepo; a test keeps the committed ones in sync.
 */
export function templateWranglerConfig(serverConfig: string) {
  const { $schema: _schema, ...source } = parseJsonc(serverConfig) as BaseConfig & { $schema?: string }
  const config = {
    $schema: 'node_modules/wrangler/config-schema.json',
    ...source,
    main: 'node_modules/orqevio/dist/worker/index.js',
    no_bundle: true,
    assets: { ...source.assets, directory: 'node_modules/orqevio/dist/web' },
  }
  return `// Generated from Orqevio's apps/server/wrangler.jsonc. On every deploy, \`npm run deploy\`
// reads only "name" and the UPLOADS "bucket_name" from this file: bindings, migrations and
// compatibility settings come from the installed package, so updating it is all it takes.
${JSON.stringify(config, null, 2)}
`
}

export function templatePackageJson(installerVersion: string) {
  const manifest = {
    name: 'orqevio-copy',
    private: true,
    description: 'Your own copy of Orqevio on Cloudflare.',
    scripts: { deploy: 'create-orqevio deploy-repo' },
    dependencies: { 'create-orqevio': installerVersion },
    engines: { node: '>=22.12' },
    cloudflare: {
      bindings: {
        SETUP_CODE: {
          description:
            'One-off code to claim your copy the first time: at least 12 letters or digits, for example from `openssl rand -hex 8`. Keep it until you open your copy; to recover access later, set a new one here and use **Lost your key?** on the sign-in screen.',
        },
        UPLOADS: { description: 'R2 bucket for the files attached to cards and documents.' },
        COPY: { description: 'Durable Object that keeps your data in its own SQLite database.' },
      },
    },
  }
  return `${JSON.stringify(manifest, null, 2)}\n`
}
