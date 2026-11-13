import { SCOPES } from '@orqevio/shared'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Env } from '../env'
import { RateLimiter } from '../lib/rate-limit'
import { type Endpoint, OAuthError } from '../services/oauth'
import { clientIp } from './middleware'
import type { AppEnv } from './types'

/**
 * This copy as an OAuth resource (its /mcp endpoint) and authorization server.
 * The issuer is the APP_URL entry the request arrived at, or the request's own
 * origin when APP_URL is not set (Cloudflare).
 */
export function endpointFor(env: Env, requestUrl: string): Endpoint {
  const url = new URL(requestUrl)
  const issuer = env.appUrls.length ? (env.appUrls.find((origin) => new URL(origin).host === url.host) ?? env.appUrls[0]!) : url.origin
  return { issuer, resource: `${issuer}/mcp` }
}

export const resourceMetadataUrl = (endpoint: Endpoint) => `${endpoint.issuer}/.well-known/oauth-protected-resource/mcp`

// These endpoints use no cookies, so any origin may call them: browser-based MCP clients do.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
  'Access-Control-Max-Age': '86400',
  'Cross-Origin-Resource-Policy': 'cross-origin',
}

function oauthError(c: Context<AppEnv>, error: OAuthError) {
  return c.json({ error: error.error, error_description: error.description }, error.status, { 'Cache-Control': 'no-store' })
}

/** Token and revocation requests are form-encoded (RFC 6749 §4.1.3); JSON is accepted too. */
async function formOf(c: Context<AppEnv>): Promise<Record<string, string>> {
  const type = c.req.header('content-type') ?? ''
  let values: Record<string, unknown>
  if (type.includes('application/x-www-form-urlencoded')) values = Object.fromEntries(new URLSearchParams(await c.req.text()))
  else if (type.includes('application/json')) values = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>
  else throw new OAuthError('invalid_request', 'Send the request as application/x-www-form-urlencoded')
  const form = Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  // Some public clients send their client_id as HTTP Basic credentials with an empty secret.
  const basic = /^Basic\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')
  if (basic && !form.client_id) {
    const user = Buffer.from(basic[1]!, 'base64').toString('utf8').split(':')[0]
    if (user) form.client_id = decodeURIComponent(user)
  }
  return form
}

export function createOAuthRoutes() {
  const app = new Hono<AppEnv>()
  const tokenLimiter = new RateLimiter(60, 60 * 1000)
  const registerLimiter = new RateLimiter(30, 60 * 60 * 1000)

  // Listed one by one: /oauth/authorize is the web app's consent page, not an API.
  const paths = ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server', '/oauth/register', '/oauth/token', '/oauth/revoke']
  for (const path of paths) {
    app.options(path, () => new Response(null, { status: 204, headers: CORS }))
    app.use(path, async (c, next) => {
      await next()
      for (const [name, value] of Object.entries(CORS)) c.res.headers.set(name, value)
    })
    if (path.startsWith('/oauth/')) {
      app.use(path, bodyLimit({ maxSize: 64 * 1024, onError: (c) => oauthError(c as Context<AppEnv>, new OAuthError('invalid_request', 'Request body too large')) }))
    }
  }

  const limited = (c: Context<AppEnv>, limiter: RateLimiter) => {
    const wait = limiter.hit(clientIp(c))
    return wait > 0 ? c.json({ error: 'slow_down', error_description: `Too many requests. Retry in ${wait}s.` }, 429, { 'Retry-After': String(wait) }) : null
  }

  // Protected Resource Metadata (RFC 9728), at the path-suffixed and the root address.
  const resourceMetadata = (c: Context<AppEnv>) => {
    const endpoint = endpointFor(c.get('config'), c.req.url)
    return c.json({
      resource: endpoint.resource,
      authorization_servers: [endpoint.issuer],
      scopes_supported: SCOPES,
      bearer_methods_supported: ['header'],
      resource_name: 'Orqevio',
    })
  }
  app.get('/.well-known/oauth-protected-resource/mcp', resourceMetadata)
  app.get('/.well-known/oauth-protected-resource', resourceMetadata)

  // Authorization Server Metadata (RFC 8414).
  app.get('/.well-known/oauth-authorization-server', (c) => {
    const { issuer } = endpointFor(c.get('config'), c.req.url)
    return c.json({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      scopes_supported: SCOPES,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    })
  })

  app.post('/oauth/register', async (c) => {
    const slow = limited(c, registerLimiter)
    if (slow) return slow
    try {
      const input = await c.req.json().catch(() => {
        throw new OAuthError('invalid_client_metadata', 'The request body must be JSON')
      })
      return c.json(await c.get('services').oauth.register(input), 201, { 'Cache-Control': 'no-store' })
    } catch (error) {
      if (error instanceof OAuthError) return oauthError(c, error)
      throw error
    }
  })

  app.post('/oauth/token', async (c) => {
    const slow = limited(c, tokenLimiter)
    if (slow) return slow
    try {
      const tokens = await c.get('services').oauth.token(await formOf(c), endpointFor(c.get('config'), c.req.url))
      return c.json(tokens, 200, { 'Cache-Control': 'no-store', Pragma: 'no-cache' })
    } catch (error) {
      if (error instanceof OAuthError) return oauthError(c, error)
      throw error
    }
  })

  app.post('/oauth/revoke', async (c) => {
    const slow = limited(c, tokenLimiter)
    if (slow) return slow
    try {
      const { token } = await formOf(c)
      if (!token) throw new OAuthError('invalid_request', 'token is required')
      await c.get('services').oauth.revoke(token)
      return c.body(null, 200)
    } catch (error) {
      if (error instanceof OAuthError) return oauthError(c, error)
      throw error
    }
  })

  return app
}
