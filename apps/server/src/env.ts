import { existsSync } from 'node:fs'
import { type InstallKind, installKind } from '@orqevio/shared'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  trustProxy: boolean
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
  /** Whether the copy looks up the latest published version (UPDATE_CHECK, on by default). */
  updateCheck: boolean
}


export function loadEnv(overrides: Partial<Env> = {}): Env {
  const nodeEnv = (process.env.NODE_ENV as Env['nodeEnv']) ?? 'development'
  const appUrls = (process.env.APP_URL ?? 'http://localhost:3000')
    .split(',')
    .map((u) => new URL(u.trim()).origin)
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
    trustProxy: bool(process.env.TRUST_PROXY, false),
    secureCookies: bool(process.env.SECURE_COOKIES, appUrls[0]!.startsWith('https://')),
    maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 20) * 1024 * 1024,
    setupCode: process.env.SETUP_CODE?.trim() || null,
    install: installKind(process.env.ORQEVIO_INSTALL, 'source'),
    copyName: process.env.ORQEVIO_COPY_NAME?.trim() || null,
    updateCheck: bool(process.env.UPDATE_CHECK, true),
    ...overrides,
  }
  return env
}
