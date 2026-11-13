import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

export const DEFAULT_NAME = 'orqevio'

// The name becomes a DNS label (<name>.<subdomain>.workers.dev) and prefixes the
// R2 bucket, whose names are limited to 63 characters.
const NAME = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/

/** Whether `name` can name a copy (see the nameRule message). */
export const isValidName = (name: string) => NAME.test(name)

export const bucketName = (name: string) => `${name}-uploads`

export interface BaseConfig {
  name: string
  main: string
  assets: { directory: string; [key: string]: unknown }
  r2_buckets: Array<{ binding: string; bucket_name?: string; [key: string]: unknown }>
  [key: string]: unknown
}

/** The installed `orqevio` package: its folder, version and base Wrangler configuration. */
export function loadOrqevio(from = import.meta.url) {
  const require = createRequire(from)
  const manifest = require.resolve('orqevio/package.json')
  const dir = path.dirname(manifest)
  const version = (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version
  const base = JSON.parse(readFileSync(path.join(dir, 'dist/wrangler.json'), 'utf8')) as BaseConfig
  return { dir: path.join(dir, 'dist'), version, base }
}

/** How the app tells this copy to update itself (see ORQEVIO_INSTALL in apps/server/src/env.ts). */
export type InstallKind = 'cli' | 'button'

/** Wrangler configuration for one copy: its own Worker name and bucket, pointing at the package files. */
export function copyConfig(base: BaseConfig, distDir: string, name: string, install: InstallKind = 'cli') {
  return {
    ...base,
    name,
    // Other variables set in the dashboard are kept (keep_vars below).
    vars: { ...(base.vars as Record<string, string> | undefined), ORQEVIO_INSTALL: install, ORQEVIO_COPY_NAME: name },
    main: path.join(distDir, base.main),
    assets: { ...base.assets, directory: path.join(distDir, base.assets.directory) },
    r2_buckets: base.r2_buckets.map((bucket) => (bucket.binding === 'UPLOADS' ? { ...bucket, bucket_name: bucketName(name) } : bucket)),
    // Variables the owner set in the Cloudflare dashboard (APP_URL, MAX_UPLOAD_MB) survive updates.
    keep_vars: true,
  }
}
