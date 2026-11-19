import { existsSync } from 'node:fs'
import { type InstallKind, installKind } from '@orqevio/shared'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { maxUploadBytes } from './lib/upload-limit'

const here = path.dirname(fileURLToPath(import.meta.url))

function bool(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

export interface Env {
  nodeEnv: 'development' | 'production' | 'test'
  port: number
  host: string
  /** SQLite database file; defaults to DATA_DIR/orqevio.db. */
  databasePath: string
  /** Public origins allowed to send cookie-authenticated requests. The first one is canonical. */
  appUrls: string[]
  dataDir: string
  webDist: string
  migrationsDir: string
  /** How many reverse proxies in front add to X-Forwarded-For (TRUST_PROXY: true is one); 0 trusts none. */
  trustProxy: number
  secureCookies: boolean
  maxUploadBytes: number
  /**
   * Secret that claims this copy the first time (and recovers access when it
   * changes). When unset, a one-off code is generated and printed at startup.
   */
  setupCode: string | null
  /** How this copy was installed (ORQEVIO_INSTALL, set by each installation path). */
  install: InstallKind
  /** Worker name of a copy installed with `npx create-orqevio` (ORQEVIO_COPY_NAME). */
  copyName: string | null
  /** Its R2 bucket, which the Deploy to Cloudflare button lets you rename (ORQEVIO_BUCKET). */
  copyBucket: string | null
  /**
   * Set by `npx create-orqevio uninstall` (ORQEVIO_UNINSTALL_TOKEN, a Worker secret) to prove it
   * controls the Cloudflare account the copy lives in: "<expiry in ms>.<random>".
   */
  uninstallToken: string | null
  /** Whether the copy looks up the latest published version (UPDATE_CHECK, on by default). */
  updateCheck: boolean
  /**
   * Node: the folder for the daily backups (BACKUP_DIR, by default DATA_DIR/backups), or null when
   * BACKUPS=off. Cloudflare keeps them in the BACKUPS bucket instead.
   */
  backupDir: string | null
  /** Cloudflare: the name of the backups bucket (ORQEVIO_BACKUP_BUCKET), to say where they are. */
  backupBucket: string | null
}

/** A setting this copy cannot start with, said plainly instead of a stack trace. */
export class ConfigError extends Error {}

/** APP_URL: one or more full addresses, comma-separated; their origins. */
export function parseAppUrls(value: string) {
  const urls = value
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)
  if (urls.length === 0) throw new ConfigError('APP_URL is empty. Set it to the address people open Orqevio at, such as https://orqevio.example.com')
  return urls.map((u) => {
    const url = URL.canParse(u) ? new URL(u) : null
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
      throw new ConfigError(`APP_URL must be full addresses starting with https:// or http://, such as https://orqevio.example.com (got "${u}")`)
    }
    return url.origin
  })
}

/** TRUST_PROXY: true (one proxy), false, or how many proxies are in front of this copy. */
export function parseTrustProxy(value: string | undefined) {
  const v = value?.trim().toLowerCase() ?? ''
  if (v === '' || ['false', 'no', 'off'].includes(v)) return 0
  if (['true', 'yes', 'on'].includes(v)) return 1
  if (/^\d{1,2}$/.test(v)) return Number(v)
  throw new ConfigError(`TRUST_PROXY must be true, false or the number of reverse proxies in front of Orqevio (got "${value}")`)
}

/** MAX_UPLOAD_MB, which the copy does not start without when it is set wrong. */
export function parseMaxUpload(value: string | undefined) {
  const bytes = maxUploadBytes(value)
  if (bytes === null) throw new ConfigError(`MAX_UPLOAD_MB must be a number of megabytes greater than 0, such as 20 (got "${value}")`)
  return bytes
}

export function loadEnv(overrides: Partial<Env> = {}): Env {
  const nodeEnv = (process.env.NODE_ENV as Env['nodeEnv']) ?? 'development'
  const appUrls = overrides.appUrls ?? parseAppUrls(process.env.APP_URL ?? 'http://localhost:3000')
  const dataDir = path.resolve(overrides.dataDir ?? process.env.DATA_DIR ?? 'data')
  const env: Env = {
    nodeEnv,
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? '0.0.0.0',
    appUrls,
    dataDir,
    databasePath: path.resolve(process.env.DATABASE_PATH ?? path.join(dataDir, 'orqevio.db')),
    // In the bundled build `here` is apps/server/dist; in dev it is apps/server/src.
    webDist: path.resolve(process.env.WEB_DIST ?? path.join(here, '../../web/dist')),
    // Bundled build: dist/drizzle. Dev: apps/server/drizzle.
    migrationsDir: path.resolve(process.env.MIGRATIONS_DIR ?? (existsSync(path.join(here, 'drizzle')) ? path.join(here, 'drizzle') : path.join(here, '../drizzle'))),
    trustProxy: overrides.trustProxy ?? parseTrustProxy(process.env.TRUST_PROXY),
    secureCookies: bool(process.env.SECURE_COOKIES, appUrls[0]!.startsWith('https://')),
    maxUploadBytes: parseMaxUpload(process.env.MAX_UPLOAD_MB),
    setupCode: process.env.SETUP_CODE?.trim() || null,
    install: installKind(process.env.ORQEVIO_INSTALL, 'source'),
    copyName: process.env.ORQEVIO_COPY_NAME?.trim() || null,
    copyBucket: process.env.ORQEVIO_BUCKET?.trim() || null,
    uninstallToken: process.env.ORQEVIO_UNINSTALL_TOKEN?.trim() || null,
    updateCheck: bool(process.env.UPDATE_CHECK, true),
    backupDir: bool(process.env.BACKUPS, true) ? path.resolve(process.env.BACKUP_DIR || path.join(dataDir, 'backups')) : null,
    backupBucket: null,
    ...overrides,
  }
  return env
}

/** loadEnv for the entry points: a setting it cannot start with is said in one line, and it stops. */
export function loadEnvOrExit(): Env {
  try {
    return loadEnv()
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    console.error(error.message)
    process.exit(1)
  }
}

/** Settings this copy starts with, but probably not as meant. */
export function configWarnings(env: Env, vars: Record<string, string | undefined> = process.env): string[] {
  const warnings: string[] = []
  const https = env.appUrls.slice(1).find((origin) => origin.startsWith('https://'))
  if (https && !env.appUrls[0]!.startsWith('https://') && !vars.SECURE_COOKIES) {
    warnings.push(
      `APP_URL starts with ${env.appUrls[0]}, so cookies are not marked Secure and HSTS is off, although ${https} is listed too: the first address decides. Put the https:// one first.`,
    )
  }
  return warnings
}
