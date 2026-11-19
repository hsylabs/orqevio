/** What a copy takes when MAX_UPLOAD_MB is not set. */
export const DEFAULT_MAX_UPLOAD_MB = 20

/**
 * MAX_UPLOAD_MB in bytes: a number of megabytes greater than 0, such as 20 or 2.5. Null when it is
 * not one, such as "20MB": taken as it was, it gave NaN, so no upload had a limit on the server,
 * and the app refused every file.
 */
export function maxUploadBytes(value: string | undefined): number | null {
  const text = value?.trim() ?? ''
  if (text === '') return DEFAULT_MAX_UPLOAD_MB * 1024 * 1024
  const megabytes = Number(text)
  return Number.isFinite(megabytes) && megabytes > 0 ? Math.round(megabytes * 1024 * 1024) : null
}

let warned = false

/**
 * MAX_UPLOAD_MB on Cloudflare: set wrong, a Worker cannot refuse to start, so it keeps the default
 * and says so once in its log.
 */
export function workerMaxUploadBytes(value: string | undefined) {
  const bytes = maxUploadBytes(value)
  if (bytes !== null) return bytes
  if (!warned) console.warn(`MAX_UPLOAD_MB must be a number of megabytes greater than 0, such as 20 (got "${value}"): using ${DEFAULT_MAX_UPLOAD_MB}`)
  warned = true
  return DEFAULT_MAX_UPLOAD_MB * 1024 * 1024
}
