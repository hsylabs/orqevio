import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { Context } from 'hono'
import { RateLimiter } from '../lib/rate-limit'
import { SCOPES } from '@orqevio/shared'
import type { AppEnv } from '../http/types'
import { bearerToken } from '../http/middleware'
import { endpointFor, resourceMetadataUrl } from '../http/oauth'
import { createMcpServer } from './server'

const limiter = new RateLimiter(300, 60 * 1000)

const rpcError = (status: number, code: number, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

/** Stateless Streamable HTTP endpoint: one short-lived MCP server per request. */
export async function handleMcp(c: Context<AppEnv>) {
  if (c.req.method !== 'POST') {
    return rpcError(405, -32000, 'Method not allowed. This server is stateless: use POST.', { Allow: 'POST' })
  }
  const services = c.get('services')
  const token = bearerToken(c)
  // A token created in «Agentes», or an OAuth access token (only valid here, not on the REST API).
  const actor = token ? ((await services.tokens.authenticate(token)) ?? (await services.oauth.authenticate(token))) : null
  if (!actor) {
    // Tells OAuth clients where to start (RFC 9728 §5.1) and which scopes to ask for.
    const challenge = [`realm="orqevio"`, `resource_metadata="${resourceMetadataUrl(endpointFor(c.get('config'), c.req.url))}"`, `scope="${SCOPES.join(' ')}"`]
    if (token !== null) challenge.push('error="invalid_token"')
    return rpcError(401, -32001, 'Missing or invalid token. Connect with OAuth, or create a token in Orqevio → Agents.', {
      'WWW-Authenticate': `Bearer ${challenge.join(', ')}`,
    })
  }
  const wait = limiter.hit(actor.tokenId)
  if (wait > 0) return rpcError(429, -32002, `Rate limit exceeded. Retry in ${wait}s.`, { 'Retry-After': String(wait) })

  const server = createMcpServer(c.get('services'), actor)
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  try {
    return await transport.handleRequest(c.req.raw)
  } finally {
    // JSON responses are fully buffered, so the per-request server can be released.
    void server.close()
  }
}
