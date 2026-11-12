import { allowedOrigins, securityHeaders } from '../http/security'
import { type Bindings, workerEnv } from './env'

export { OrqevioCopy } from './copy'

/** Everything with data goes to the copy's Durable Object; the rest is the web app. */
const TO_COPY = /^\/(?:api\/|mcp$|healthz$|oauth\/(?:register|token|revoke)$|\.well-known\/oauth-)/

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (TO_COPY.test(url.pathname)) return env.COPY.getByName('copy').fetch(request)

    // Static web app (single-page fallback), with the same security headers as the API.
    const response = await env.ASSETS.fetch(request)
    const headers = new Headers(response.headers)
    const security = securityHeaders(allowedOrigins(workerEnv(env), request.url), url.protocol === 'https:')
    for (const [name, value] of Object.entries(security)) headers.set(name, value)
    if (headers.get('content-type')?.includes('text/html')) headers.set('Cache-Control', 'no-cache')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  },
} satisfies ExportedHandler<Bindings>
