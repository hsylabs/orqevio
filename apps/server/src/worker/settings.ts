import { ConfigError, parseAppUrls } from '../lib/app-urls'

/**
 * APP_URL on Cloudflare: optional (each visit's own address is used then), but when it is set it
 * takes the same full https:// or http:// addresses as on Node, or the copy says what is wrong.
 */
export function workerAppUrls(value: string | undefined) {
  return value?.split(',').some((url) => url.trim()) ? parseAppUrls(value) : []
}

/** What is wrong with APP_URL, said plainly; null when the copy can serve with it. */
export function appUrlProblem(value: string | undefined) {
  try {
    workerAppUrls(value)
    return null
  } catch (error) {
    if (error instanceof ConfigError) return error.message
    throw error
  }
}
