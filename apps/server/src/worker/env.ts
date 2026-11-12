import type { Env } from '../env'
import type { OrqevioCopy } from './copy'

/** Bindings declared in wrangler.jsonc. */
export interface Bindings {
  COPY: DurableObjectNamespace<OrqevioCopy>
  UPLOADS: R2Bucket
  ASSETS: Fetcher
  /** Secret: claims the copy the first time and recovers access when it changes. */
  SETUP_CODE?: string
  /** Optional: public origins, comma-separated. Defaults to the origin of each request. */
  APP_URL?: string
  MAX_UPLOAD_MB?: string
}

export function workerEnv(bindings: Bindings): Env {
  const appUrls = (bindings.APP_URL ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => new URL(url).origin)
  return {
    nodeEnv: 'production',
    port: 0,
    host: '',
    appUrls,
    dataDir: '',
    databasePath: '',
    webDist: '',
    migrationsDir: '',
    trustProxy: false,
    secureCookies: true,
    maxUploadBytes: Number(bindings.MAX_UPLOAD_MB ?? 20) * 1024 * 1024,
    setupCode: bindings.SETUP_CODE?.trim() || null,
  }
}
