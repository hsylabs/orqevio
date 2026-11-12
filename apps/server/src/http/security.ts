import type { Env } from '../env'

/**
 * Origins allowed to send cookie-authenticated writes and to open live
 * connections: APP_URL when configured, otherwise the origin the request was
 * sent to (same-origin only). The latter lets a Cloudflare copy work on its
 * workers.dev address and on a custom domain without configuration.
 */
export function allowedOrigins(env: Env, requestUrl: string) {
  return env.appUrls.length ? env.appUrls : [new URL(requestUrl).origin]
}

/** Security headers for every HTML/API response, shared by the Node app and the Cloudflare entry. */
export function securityHeaders(origins: string[], https: boolean): Record<string, string> {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // Live updates use WebSocket; list the app's own ws(s) origins explicitly,
    // since not every browser lets 'self' cover them.
    `connect-src 'self' ${origins.map((o) => o.replace(/^http/, 'ws')).join(' ')}`,
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
  return {
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-DNS-Prefetch-Control': 'off',
    'X-Download-Options': 'noopen',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'Origin-Agent-Cluster': '?1',
    ...(https ? { 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains' } : {}),
  }
}
