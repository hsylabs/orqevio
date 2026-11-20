import { allowedOrigins, securityHeaders } from '../http/security'
import { type Bindings, workerConfigProblem, workerEnv } from './env'
import { misconfigured } from './misconfigured'

export { OrqevioCopy } from './copy'

/** The settings problem already in the log, once per instance rather than on every request. */
let logged: string | null = null

/** Everything with data goes to the copy's Durable Object; the rest is the web app. */
const TO_COPY = /^\/(?:api\/|mcp$|healthz$|oauth\/(?:register|token|revoke)$|\.well-known\/)/

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    // Settings it can't serve with (APP_URL that isn't a full address): said on every request, and in the log.
    const problem = workerConfigProblem(env)
    if (problem) {
      if (logged !== problem) console.error(`Orqevio can't start: ${problem}`)
      logged = problem
      return misconfigured(request, problem)
    }
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
