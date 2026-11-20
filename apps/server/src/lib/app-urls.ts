// Shared by Node and the Cloudflare Worker: nothing here may touch the file system.

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
