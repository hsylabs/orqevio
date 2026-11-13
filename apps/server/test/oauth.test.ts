import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createHash, randomBytes } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client, type Harness, ORIGIN, createHarness, signUp } from './harness'

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'
const RESOURCE = `${ORIGIN}/mcp`

let h: Harness
let owner: Client
let workspaceId: string
beforeAll(async () => {
  h = await createHarness()
  ;({ client: owner, workspaceId } = await signUp(h))
})
afterAll(async () => h.close())
afterEach(() => vi.unstubAllGlobals())

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

async function call(path: string, init: RequestInit = {}) {
  const res = await h.app.request(path, init)
  const text = await res.text()
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null }
}

async function register(redirectUris = [REDIRECT], name = 'Claude') {
  const res = await call('/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: name, redirect_uris: redirectUris, grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: 'none', application_type: 'web' }),
  })
  expect(res.status).toBe(201)
  return res.body.client_id as string
}

const token = (form: Record<string, string>) =>
  call('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() })

function authorizeParams(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  return { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'st-123', scope: 'tasks:read tasks:write', resource: RESOURCE, ...extra }
}

/** The owner approves on the consent screen; returns the authorization code. */
async function approve(clientId: string, challenge: string, scopes = ['tasks:read'], extra: Record<string, string> = {}) {
  const params = authorizeParams(clientId, challenge, extra)
  const decision = await owner.post('/api/oauth/decision', { params, allow: true, workspaceId, scopes })
  expect(decision.status).toBe(200)
  const url = new URL(decision.body.redirect)
  expect(url.searchParams.get('state')).toBe('st-123')
  expect(url.searchParams.get('iss')).toBe(ORIGIN)
  return url.searchParams.get('code')!
}

/** Registration, consent and code exchange, as a client like Claude does them. */
async function connectApp(scopes = ['tasks:read']) {
  const clientId = await register()
  const { verifier, challenge } = pkce()
  const code = await approve(clientId, challenge, scopes)
  const res = await token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT, resource: RESOURCE })
  expect(res.status).toBe(200)
  return { clientId, tokens: res.body as { access_token: string; refresh_token: string; scope: string; expires_in: number; token_type: string } }
}

async function mcp(accessToken: string) {
  const client = new McpClient({ name: 'test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(RESOURCE), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
    fetch: async (url, init) => h.app.request(String(url), init as RequestInit),
  })
  await client.connect(transport)
  return client
}

const mcpStatus = async (accessToken: string) =>
  (
    await h.app.request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
  ).status

describe('OAuth discovery', () => {
  it('points clients from a 401 on /mcp to the metadata of this copy', async () => {
    const res = await h.app.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(401)
    const challenge = res.headers.get('www-authenticate')!
    expect(challenge).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`)
    expect(challenge).toContain('scope="tasks:read tasks:write docs:read docs:write"')
    expect(challenge).not.toContain('error=')
    const invalid = await h.app.request('/mcp', { method: 'POST', headers: { Authorization: 'Bearer orqat_nope', 'Content-Type': 'application/json' }, body: '{}' })
    expect(invalid.headers.get('www-authenticate')).toContain('error="invalid_token"')

    for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
      const prm = await call(path)
      expect(prm.body).toMatchObject({ resource: RESOURCE, authorization_servers: [ORIGIN], scopes_supported: ['tasks:read', 'tasks:write', 'docs:read', 'docs:write'] })
      expect(prm.headers.get('access-control-allow-origin')).toBe('*')
    }
    const as = await call('/.well-known/oauth-authorization-server')
    expect(as.body).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    })
    const preflight = await h.app.request('/oauth/token', { method: 'OPTIONS', headers: { Origin: 'https://inspector.example', 'Access-Control-Request-Method': 'POST' } })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
  })
})

describe('connecting an application with OAuth', () => {
  it('asks the owner, then the application sees only the tools it was allowed', async () => {
    const clientId = await register()
    const { challenge } = pkce()
    const consent = await owner.post('/api/oauth/request', { params: authorizeParams(clientId, challenge) })
    expect(consent.body).toEqual({ kind: 'consent', client: { id: clientId, name: 'Claude', publishedBy: null, redirectUri: REDIRECT }, scopes: ['tasks:read', 'tasks:write'] })

    const { tokens } = await connectApp(['tasks:read'])
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'tasks:read' })
    expect(tokens.access_token).toMatch(/^orqat_/)
    expect(tokens.refresh_token).toMatch(/^orqrt_/)
    const names = (await (await mcp(tokens.access_token)).listTools()).tools.map((t) => t.name)
    expect(names).toContain('get_board')
    expect(names).not.toContain('create_card')
    expect(names).not.toContain('read_page')

    // The grant is listed and revocable in «Agentes».
    const list = await owner.get('/api/tokens')
    const grant = list.body.find((t: { oauth: unknown }) => t.oauth)
    expect(grant).toMatchObject({ name: 'Claude', workspaceId, scopes: ['tasks:read'], oauth: { redirectUri: REDIRECT } })
  })

  it('keeps OAuth tokens to /mcp: not the REST API, and never the vault', async () => {
    const { tokens } = await connectApp(['tasks:read', 'docs:read'])
    const rest = new Client(h, tokens.access_token)
    expect((await rest.get(`/api/workspaces/${workspaceId}/overview`)).status).toBe(401)
    // Rejected as a token before the vault's own session-only rule is even reached.
    expect((await rest.get('/api/vault')).status).toBe(401)
    // Consent can only come from the owner's browser session.
    expect((await rest.post('/api/oauth/request', { params: {} })).status).toBe(401)
  })

  it('refuses a wrong verifier, client or return address when exchanging the code', async () => {
    const clientId = await register()
    const { verifier, challenge } = pkce()
    const code = await approve(clientId, challenge)
    const base = { grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: REDIRECT }
    expect((await token({ ...base, code_verifier: pkce().verifier })).body.error).toBe('invalid_grant')
    expect((await token({ ...base, code_verifier: verifier, client_id: await register([REDIRECT], 'Otra') })).body.error).toBe('invalid_grant')
    expect((await token({ ...base, code_verifier: verifier, redirect_uri: 'https://claude.ai/otra' })).body.error).toBe('invalid_grant')
    expect((await token({ ...base, code_verifier: verifier, resource: 'https://other.example/mcp' })).body.error).toBe('invalid_target')
    expect((await token({ ...base, code_verifier: verifier })).status).toBe(200)
    expect((await token({ grant_type: 'password', username: 'a', password: 'b' })).body.error).toBe('unsupported_grant_type')
  })

  it('revokes what a code gave when the code is presented twice', async () => {
    const clientId = await register()
    const { verifier, challenge } = pkce()
    const code = await approve(clientId, challenge)
    const form = { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId }
    const first = await token(form)
    expect(await mcpStatus(first.body.access_token)).toBe(200)
    expect((await token(form)).body.error).toBe('invalid_grant')
    expect(await mcpStatus(first.body.access_token)).toBe(401)
  })

  it('rotates refresh tokens, and a replayed one ends the access', async () => {
    const { clientId, tokens } = await connectApp()
    const next = await token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId })
    expect(next.status).toBe(200)
    expect(next.body.refresh_token).not.toBe(tokens.refresh_token)
    expect(await mcpStatus(next.body.access_token)).toBe(200)
    expect((await token({ grant_type: 'refresh_token', refresh_token: next.body.refresh_token, client_id: clientId, scope: 'docs:write' })).body.error).toBe('invalid_scope')

    const replay = await token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId })
    expect(replay.body.error).toBe('invalid_grant')
    expect(await mcpStatus(next.body.access_token)).toBe(401)
    expect((await token({ grant_type: 'refresh_token', refresh_token: next.body.refresh_token, client_id: clientId })).body.error).toBe('invalid_grant')
  })

  it('revokes the access when the same refresh token is exchanged twice at once', async () => {
    const { clientId, tokens } = await connectApp()
    const form = { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId }
    const results = await Promise.all([token(form), token(form)])
    expect(results.some((r) => r.body.error === 'invalid_grant')).toBe(true)
    for (const issued of results.filter((r) => r.status === 200)) expect(await mcpStatus(issued.body.access_token)).toBe(401)
  })

  it('stops working when revoked in «Agentes» or by the application', async () => {
    const first = await connectApp()
    const grant = (await owner.get('/api/tokens')).body.find((t: { oauth: { clientId: string } | null }) => t.oauth?.clientId === first.clientId)
    expect((await owner.del(`/api/tokens/${grant.id}`)).status).toBe(204)
    expect(await mcpStatus(first.tokens.access_token)).toBe(401)
    expect((await token({ grant_type: 'refresh_token', refresh_token: first.tokens.refresh_token, client_id: first.clientId })).body.error).toBe('invalid_grant')

    const second = await connectApp()
    const revoked = await call('/oauth/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `token=${second.tokens.refresh_token}` })
    expect(revoked.status).toBe(200)
    expect(await mcpStatus(second.tokens.access_token)).toBe(401)
  })
})

describe('authorization requests', () => {
  it('never sends the browser to an address the application did not register', async () => {
    const clientId = await register()
    const { challenge } = pkce()
    const unknown = await owner.post('/api/oauth/request', { params: authorizeParams('dcr_forged.signature', challenge) })
    expect(unknown).toMatchObject({ status: 200, body: { kind: 'problem', problem: 'unknown_client' } })
    const [payload] = clientId.slice(4).split('.')
    const tampered = await owner.post('/api/oauth/request', { params: authorizeParams(`dcr_${payload}.${'A'.repeat(43)}`, challenge) })
    expect(tampered.body.problem).toBe('unknown_client')
    const elsewhere = await owner.post('/api/oauth/request', { params: authorizeParams(clientId, challenge, { redirect_uri: 'https://evil.example/callback' }) })
    expect(elsewhere.body).toMatchObject({ kind: 'problem', problem: 'bad_redirect' })
    // The decision endpoint refuses them too, without redirecting anywhere.
    const forced = await owner.post('/api/oauth/decision', { params: authorizeParams(clientId, challenge, { redirect_uri: 'https://evil.example/callback' }), allow: true, workspaceId, scopes: ['tasks:read'] })
    expect(forced).toMatchObject({ status: 400, body: { error: { code: 'oauth_invalid_redirect' } } })
  })

  it('reports other problems, and a refusal, back to the application', async () => {
    const clientId = await register()
    const { challenge } = pkce()
    const errorOf = async (params: Record<string, string>) => {
      const res = await owner.post('/api/oauth/request', { params })
      expect(res.body.kind).toBe('redirect')
      const url = new URL(res.body.redirect)
      expect(url.origin + url.pathname).toBe(REDIRECT)
      expect(url.searchParams.get('state')).toBe('st-123')
      return url.searchParams.get('error')
    }
    expect(await errorOf(authorizeParams(clientId, challenge, { code_challenge_method: 'plain' }))).toBe('invalid_request')
    expect(await errorOf(authorizeParams(clientId, ''))).toBe('invalid_request')
    expect(await errorOf(authorizeParams(clientId, challenge, { response_type: 'token' }))).toBe('unsupported_response_type')
    expect(await errorOf(authorizeParams(clientId, challenge, { resource: 'https://other.example/mcp' }))).toBe('invalid_target')

    const denied = await owner.post('/api/oauth/decision', { params: authorizeParams(clientId, challenge), allow: false })
    expect(new URL(denied.body.redirect).searchParams.get('error')).toBe('access_denied')
    const none = await owner.post('/api/oauth/decision', { params: authorizeParams(clientId, challenge), allow: true, workspaceId, scopes: [] })
    expect(none.status).toBe(400)
  })

  it('accepts any port on a loopback return address, as native apps need', async () => {
    const clientId = await register(['http://127.0.0.1/callback'], 'Claude Code')
    const { challenge } = pkce()
    const res = await owner.post('/api/oauth/request', { params: authorizeParams(clientId, challenge, { redirect_uri: 'http://127.0.0.1:43123/callback' }) })
    expect(res.body.kind).toBe('consent')
    const bad = await call('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://example.com/callback'] }) })
    expect(bad.body.error).toBe('invalid_redirect_uri')
  })
})

describe('Client ID Metadata Documents', () => {
  const CLIENT = 'https://app.example.com/oauth/client.json'
  const document = { client_id: CLIENT, client_name: 'Ejemplo', redirect_uris: ['https://app.example.com/callback'], token_endpoint_auth_method: 'none' }

  it('reads the application from the https address it uses as client_id', async () => {
    const fetchMock = vi.fn(async (_url: URL | string, _init?: RequestInit) => Response.json(document))
    vi.stubGlobal('fetch', fetchMock)
    const { verifier, challenge } = pkce()
    const params = authorizeParams(CLIENT, challenge, { redirect_uri: 'https://app.example.com/callback' })
    const consent = await owner.post('/api/oauth/request', { params })
    expect(consent.body.client).toEqual({ id: CLIENT, name: 'Ejemplo', publishedBy: 'app.example.com', redirectUri: 'https://app.example.com/callback' })
    expect(String(fetchMock.mock.calls[0]![0])).toBe(CLIENT)
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' })

    const decision = await owner.post('/api/oauth/decision', { params, allow: true, workspaceId, scopes: ['docs:read'] })
    const code = new URL(decision.body.redirect).searchParams.get('code')!
    const res = await token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: CLIENT })
    expect(res.body.scope).toBe('docs:read')
  })

  it('rejects documents that do not match, redirects and private addresses', async () => {
    const { challenge } = pkce()
    const reject = async (clientId: string, response?: Response) => {
      const fetchMock = vi.fn(async () => response ?? Response.json(document))
      vi.stubGlobal('fetch', fetchMock)
      const res = await owner.post('/api/oauth/request', { params: authorizeParams(clientId, challenge, { redirect_uri: 'https://app.example.com/callback' }) })
      expect(res.body).toMatchObject({ kind: 'problem', problem: 'unknown_client' })
      return fetchMock.mock.calls.length
    }
    expect(await reject('https://other.example.com/client.json')).toBe(1)
    expect(await reject('https://third.example.com/client.json', new Response(null, { status: 302, headers: { Location: 'https://app.example.com/oauth/client.json' } }))).toBe(1)
    expect(await reject('https://fourth.example.com/client.json', Response.json({ ...document, client_id: 'https://fourth.example.com/client.json', token_endpoint_auth_method: 'client_secret_basic' }))).toBe(1)
    for (const address of ['https://127.0.0.1/client.json', 'https://localhost/client.json', 'https://router.local/client.json', 'http://app.example.com/client.json', 'https://app.example.com', 'https://app.example.com:8443/client.json']) {
      expect(await reject(address)).toBe(0)
    }
  })
})
