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
  databaseUrl: string
  /** Public origins allowed to send cookie-authenticated requests. The first one is canonical. */
  appUrls: string[]
  dataDir: string
  webDist: string
  migrationsDir: string
  trustProxy: boolean
  secureCookies: boolean
  maxUploadBytes: number
}

export function loadEnv(overrides: Partial<Env> = {}): Env {
  const nodeEnv = (process.env.NODE_ENV as Env['nodeEnv']) ?? 'development'
  const databaseUrl = overrides.databaseUrl ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required')
  const appUrls = (process.env.APP_URL ?? 'http://localhost:3000')
    .split(',')
    .map((u) => new URL(u.trim()).origin)
  const env: Env = {
    nodeEnv,
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? '0.0.0.0',
    databaseUrl,
    appUrls,
    dataDir: path.resolve(process.env.DATA_DIR ?? 'data'),
    // In the bundled build `here` is apps/server/dist; in dev it is apps/server/src.
    webDist: path.resolve(process.env.WEB_DIST ?? path.join(here, '../../web/dist')),
    migrationsDir: path.resolve(process.env.MIGRATIONS_DIR ?? path.join(here, '../drizzle')),
    trustProxy: bool(process.env.TRUST_PROXY, false),
    secureCookies: bool(process.env.SECURE_COOKIES, appUrls[0]!.startsWith('https://')),
    maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 20) * 1024 * 1024,
    ...overrides,
  }
  return env
}
