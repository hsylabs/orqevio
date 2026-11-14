import type { OAuthDecisionDTO, OAuthRequestDTO, Scope } from '@orqevio/shared'
import { SCOPES, oauthDecisionInput, oauthRequestInput } from '@orqevio/shared'
import { createHash, createHmac } from 'node:crypto'
import { and, desc, eq, gt, isNull, lt, or } from 'drizzle-orm'
import { z } from 'zod'
import type { Actor, AgentActor } from '../auth/actor'
import { randomToken, safeEqual, sha256 } from '../auth/crypto'
import { apiTokens, copyState, oauthCodes, oauthTokens, workspaceMembers } from '../db/schema'
import { AppError, badRequest } from '../lib/errors'
import { parse } from '../lib/validate'
import type { Access } from './access'
import type { Deps } from './deps'
import type { TokenService } from './tokens'

/**
 * OAuth 2.1 authorization server for the MCP endpoint (MCP authorization,
 * revision 2026-07-28). Lets clients that only speak OAuth, such as Claude's
 * custom connectors, connect after the owner approves them on a consent screen.
 *
 * - Clients identify themselves with a Client ID Metadata Document (an https
 *   URL that is fetched), or register with Dynamic Client Registration. DCR
 *   stores nothing: the client_id carries its redirect URIs, signed.
 * - Public clients only, with PKCE (S256). Tokens are bound to this copy's
 *   /mcp resource and are not accepted by the REST API.
 * - Each approval is a grant stored as an api_tokens row, so it is listed and
 *   revoked in «Agentes» like any token and its actions are attributed to it.
 * - Access tokens last an hour. Refresh tokens are single use: presenting one
 *   twice revokes the grant, as does presenting an authorization code twice.
 */

export const ACCESS_PREFIX = 'orqat_'
export const REFRESH_PREFIX = 'orqrt_'
const REGISTERED_PREFIX = 'dcr_'
const ACCESS_TTL_MS = 60 * 60 * 1000
const REFRESH_TTL_MS = 30 * 86_400_000
const CODE_TTL_MS = 5 * 60 * 1000
/** Used refresh tokens are kept this long to notice a stolen one being replayed. */
const ROTATED_KEPT_MS = 7 * 86_400_000
const METADATA_TTL_MS = 10 * 60 * 1000
const METADATA_MAX_BYTES = 64 * 1024
const SIGNING_KEY = 'oauth_signing_key'

/** Where this copy is reached: the issuer (its origin) and the MCP resource. */
export interface Endpoint {
  issuer: string
  resource: string
}

/** An error in the format of RFC 6749 §5.2, for the token, registration and revocation endpoints. */
export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status: 400 | 401 = 400,
  ) {
    super(description)
  }
}

interface Client {
  id: string
  name: string
  redirectUris: string[]
  /** Host of the Client ID Metadata Document; null for a self-registered client. */
  publishedBy: string | null
}

export interface TokenResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
  scope: string
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])
const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'blob:', 'vbscript:', 'about:', 'ws:', 'wss:', 'ftp:'])
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/

/** Redirect URIs a client may use: https, http on the user's own computer (RFC 8252), or an app's own scheme. */
export function validRedirectUri(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (value.includes('#') || url.username || url.password) return false
  if (url.protocol === 'https:') return true
  if (url.protocol === 'http:') return LOOPBACK.has(url.hostname)
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && !BLOCKED_SCHEMES.has(url.protocol)
}

/** Exact match, except that a loopback redirect may use any port (RFC 8252 §7.3). */
function redirectMatches(registered: string, requested: string) {
  if (registered === requested) return true
  try {
    const a = new URL(registered)
    const b = new URL(requested)
    return a.protocol === 'http:' && b.protocol === 'http:' && LOOPBACK.has(a.hostname) && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search
  } catch {
    return false
  }
}

/** Client ID Metadata Document URLs: https, with a path, on a public host name. */
function metadataUrl(clientId: string): URL | null {
  let url: URL
  try {
    url = new URL(clientId)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port || url.pathname === '/') return null
  const host = url.hostname
  if (host.startsWith('[') || /^[\d.]+$/.test(host) || !host.includes('.')) return null
  if (/(^|\.)(localhost|local|localdomain|internal|lan|home\.arpa)$/.test(host)) return null
  return url
}

/** The resource indicator (RFC 8707) must name this copy's MCP endpoint (or the copy itself). */
function sameResource(value: string, endpoint: Endpoint) {
  try {
    const url = new URL(value)
    if (url.search || url.hash) return false
    const canonical = `${url.origin}${url.pathname.replace(/\/+$/, '')}`
    return canonical === endpoint.resource || canonical === endpoint.issuer
  } catch {
    return false
  }
}

/** A name to show: printable, single line, at most 60 characters. */
function cleanName(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60)
}

function hostOf(uri: string) {
  try {
    const url = new URL(uri)
    return url.hostname || url.protocol.replace(':', '')
  } catch {
    return 'Application'
  }
}

/** Requested scopes this copy knows about; write access implies read access. */
function withReads(scopes: Iterable<string>): Scope[] {
  const set = new Set([...scopes].filter((s): s is Scope => (SCOPES as readonly string[]).includes(s)))
  if (set.has('tasks:write')) set.add('tasks:read')
  if (set.has('docs:write')) set.add('docs:read')
  return SCOPES.filter((s) => set.has(s))
}

function withParams(uri: string, values: Record<string, string | undefined>) {
  const url = new URL(uri)
  for (const [key, value] of Object.entries(values)) if (value !== undefined) url.searchParams.set(key, value)
  return url.toString()
}

async function readCapped(response: Response, max: number) {
  if (Number(response.headers.get('content-length') ?? 0) > max) throw new Error('too large')
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      throw new Error('too large')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const registrationInput = z.object({
  redirect_uris: z.array(z.string().max(500)).min(1).max(5),
  client_name: z.string().max(200).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
})

const invalidGrant = (description = 'The code or refresh token is invalid, expired or already used') => new OAuthError('invalid_grant', description)

export class OAuthService {
  private signingKey: string | null = null
  private readonly metadata = new Map<string, { client: Client; until: number }>()

  constructor(
    private readonly deps: Deps,
    private readonly access: Access,
    private readonly tokens: TokenService,
  ) {}

  // ── Clients ─────────────────────────────────────────────────────
  /** Dynamic Client Registration (RFC 7591). Nothing is stored: the client_id is signed. */
  async register(input: unknown) {
    const result = registrationInput.safeParse(input)
    if (!result.success) throw new OAuthError('invalid_client_metadata', 'redirect_uris must list one to five addresses')
    const data = result.data
    const bad = data.redirect_uris.find((uri) => !validRedirectUri(uri))
    if (bad) throw new OAuthError('invalid_redirect_uri', `Not an allowed redirect URI: ${bad.slice(0, 100)}`)
    if (data.grant_types && !data.grant_types.includes('authorization_code')) throw new OAuthError('invalid_client_metadata', 'Only the authorization_code grant is supported')
    if (data.response_types && !data.response_types.every((type) => type === 'code')) throw new OAuthError('invalid_client_metadata', 'Only response_type=code is supported')
    const name = cleanName(data.client_name) || hostOf(data.redirect_uris[0]!)
    const payload = Buffer.from(JSON.stringify({ n: name, r: data.redirect_uris })).toString('base64url')
    return {
      client_id: `${REGISTERED_PREFIX}${payload}.${await this.sign(payload)}`,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: data.redirect_uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }

  private async sign(payload: string) {
    if (!this.signingKey) {
      await this.deps.db.insert(copyState).values({ key: SIGNING_KEY, value: randomToken(32) }).onConflictDoNothing()
      const [row] = await this.deps.db.select({ value: copyState.value }).from(copyState).where(eq(copyState.key, SIGNING_KEY))
      this.signingKey = row!.value
    }
    return createHmac('sha256', this.signingKey).update(`dcr:${payload}`).digest('base64url')
  }

  private async client(clientId: string): Promise<Client> {
    if (clientId.startsWith(REGISTERED_PREFIX)) {
      const [payload, signature] = clientId.slice(REGISTERED_PREFIX.length).split('.')
      if (payload && signature && safeEqual(signature, await this.sign(payload))) {
        const { n, r } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { n: string; r: string[] }
        return { id: clientId, name: n, redirectUris: r, publishedBy: null }
      }
      throw new OAuthError('invalid_client', 'This application is not registered with this copy')
    }
    const url = metadataUrl(clientId)
    if (!url) throw new OAuthError('invalid_client', 'This application is not registered with this copy')
    return this.fetchMetadata(clientId, url)
  }

  /** Client ID Metadata Document: fetched over https, never following redirects, and cached for a while. */
  private async fetchMetadata(clientId: string, url: URL): Promise<Client> {
    const cached = this.metadata.get(clientId)
    if (cached && cached.until > Date.now()) return cached.client
    const fail = (why: string) => new OAuthError('invalid_client', `The application's description at ${url.host} ${why}`)
    let body: string
    try {
      const response = await (this.deps.publicFetch ?? this.deps.fetch ?? fetch)(url, { redirect: 'manual', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) })
      if (response.status !== 200) {
        await response.body?.cancel()
        throw fail(`answered with status ${response.status}`)
      }
      body = await readCapped(response, METADATA_MAX_BYTES)
    } catch (error) {
      if (error instanceof OAuthError) throw error
      throw fail('could not be read')
    }
    let doc: Record<string, unknown>
    try {
      doc = JSON.parse(body) as Record<string, unknown>
    } catch {
      throw fail('is not valid JSON')
    }
    if (doc?.client_id !== clientId) throw fail('names a different client_id')
    const uris = doc.redirect_uris
    if (!Array.isArray(uris) || uris.length === 0 || uris.length > 20 || !uris.every((uri) => typeof uri === 'string' && uri.length <= 500 && validRedirectUri(uri))) {
      throw fail('has no valid redirect_uris')
    }
    const method = doc.token_endpoint_auth_method ?? 'none'
    if (method !== 'none') throw fail(`asks for ${String(method).slice(0, 40)}, and this copy only supports public clients with PKCE`)
    const client: Client = { id: clientId, name: cleanName(doc.client_name) || url.hostname, redirectUris: uris as string[], publishedBy: url.hostname }
    if (this.metadata.size >= 100) this.metadata.clear()
    this.metadata.set(clientId, { client, until: Date.now() + METADATA_TTL_MS })
    return client
  }

  // ── Consent ─────────────────────────────────────────────────────
  /**
   * Checks an authorization request. Problems with the application or its
   * return address are shown to the owner (never redirected, RFC 6749 §4.1.2.1);
   * any other problem is reported back to the application.
   */
  private async check(params: Record<string, string>, endpoint: Endpoint) {
    const clientId = params.client_id
    if (!clientId) throw new AppError(400, 'oauth_invalid_client', 'The request does not say which application it comes from.')
    let client: Client
    try {
      client = await this.client(clientId)
    } catch (error) {
      if (error instanceof OAuthError) throw new AppError(400, 'oauth_invalid_client', error.description)
      throw error
    }
    const requested = params.redirect_uri
    const redirectUri = requested
      ? client.redirectUris.some((uri) => redirectMatches(uri, requested))
        ? requested
        : null
      : client.redirectUris.length === 1
        ? client.redirectUris[0]!
        : null
    if (!redirectUri) throw new AppError(400, 'oauth_invalid_redirect', 'The return address does not belong to this application.')
    const back = (error: string, description: string) => ({
      kind: 'redirect' as const,
      redirect: withParams(redirectUri, { error, error_description: description, state: params.state, iss: endpoint.issuer }),
    })
    if (params.response_type !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported')
    if (params.code_challenge_method !== 'S256' || !VERIFIER.test(params.code_challenge ?? '')) return back('invalid_request', 'PKCE with code_challenge_method=S256 is required')
    if (params.resource && !sameResource(params.resource, endpoint)) return back('invalid_target', `This copy only issues tokens for ${endpoint.resource}`)
    return {
      kind: 'consent' as const,
      client,
      redirectUri,
      state: params.state,
      codeChallenge: params.code_challenge!,
      scopes: withReads((params.scope ?? '').split(' ')),
    }
  }

  /** What the consent screen shows, or where to send the browser back when the request cannot go ahead. */
  async request(actor: Actor, input: unknown, endpoint: Endpoint): Promise<OAuthRequestDTO> {
    this.access.requireUser(actor)
    let checked: Awaited<ReturnType<OAuthService['check']>>
    try {
      checked = await this.check(parse(oauthRequestInput, input).params, endpoint)
    } catch (error) {
      if (error instanceof AppError && (error.code === 'oauth_invalid_client' || error.code === 'oauth_invalid_redirect')) {
        return { kind: 'problem', problem: error.code === 'oauth_invalid_client' ? 'unknown_client' : 'bad_redirect', detail: error.message }
      }
      throw error
    }
    if (checked.kind === 'redirect') return checked
    const { client } = checked
    // What this application can already reach, so the screen can offer to replace it when reconnecting.
    const now = new Date()
    const existing = await this.deps.db
      .select({ workspaceId: apiTokens.workspaceId, createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt })
      .from(apiTokens)
      .where(and(eq(apiTokens.userId, actor.userId), eq(apiTokens.oauthClientId, client.id), isNull(apiTokens.revokedAt), or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now))))
      .orderBy(desc(apiTokens.lastUsedAt))
    return {
      kind: 'consent',
      client: { id: client.id, name: client.name, publishedBy: client.publishedBy, redirectUri: checked.redirectUri },
      scopes: checked.scopes,
      existing: existing.map((e) => ({ workspaceId: e.workspaceId, createdAt: e.createdAt.toISOString(), lastUsedAt: e.lastUsedAt?.toISOString() ?? null })),
    }
  }

  /** The owner's answer: an authorization code, or access_denied. */
  async decide(actor: Actor, input: unknown, endpoint: Endpoint): Promise<OAuthDecisionDTO> {
    this.access.requireUser(actor)
    const data = parse(oauthDecisionInput, input)
    const checked = await this.check(data.params, endpoint)
    if (checked.kind === 'redirect') return { redirect: checked.redirect }
    const reply = (values: Record<string, string>) => ({ redirect: withParams(checked.redirectUri, { ...values, state: checked.state, iss: endpoint.issuer }) })
    if (!data.allow) return reply({ error: 'access_denied', error_description: 'The owner of this copy did not allow access' })
    if (!data.workspaceId) throw badRequest('Choose a workspace')
    await this.access.workspace(actor, data.workspaceId)
    const scopes = withReads(data.scopes ?? [])
    if (scopes.length === 0) throw badRequest('Allow at least read access to one area')
    const code = randomToken(32)
    const now = Date.now()
    // Codes are kept a little after they expire, to notice one being replayed.
    await this.deps.db.delete(oauthCodes).where(lt(oauthCodes.expiresAt, new Date(now - 60 * 60 * 1000)))
    await this.deps.db.insert(oauthCodes).values({
      id: sha256(code),
      userId: actor.userId,
      workspaceId: data.workspaceId,
      clientId: checked.client.id,
      clientName: checked.client.name,
      redirectUri: checked.redirectUri,
      codeChallenge: checked.codeChallenge,
      scopes,
      expiresAt: new Date(now + CODE_TTL_MS),
      replacePrevious: data.replace === true,
    })
    return reply({ code })
  }

  // ── Tokens ──────────────────────────────────────────────────────
  async token(form: Record<string, string>, endpoint: Endpoint): Promise<TokenResponse> {
    if (form.resource && !sameResource(form.resource, endpoint)) throw new OAuthError('invalid_target', `This copy only issues tokens for ${endpoint.resource}`)
    if (form.grant_type === 'authorization_code') return this.exchangeCode(form)
    if (form.grant_type === 'refresh_token') return this.refresh(form)
    throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token')
  }

  private async exchangeCode(form: Record<string, string>) {
    const { code, code_verifier: verifier, client_id: clientId } = form
    if (!code || !verifier || !clientId) throw new OAuthError('invalid_request', 'code, code_verifier and client_id are required')
    const db = this.deps.db
    const [row] = await db.select().from(oauthCodes).where(eq(oauthCodes.id, sha256(code)))
    if (!row || row.clientId !== clientId) throw invalidGrant()
    if (row.usedAt) {
      // A code presented twice may have leaked: what it was exchanged for stops working.
      if (row.tokenId) await this.revokeGrant(row.tokenId)
      throw invalidGrant()
    }
    if (row.expiresAt <= new Date()) throw invalidGrant('The authorization code has expired')
    if (form.redirect_uri && form.redirect_uri !== row.redirectUri) throw invalidGrant('redirect_uri does not match the authorization request')
    if (!VERIFIER.test(verifier) || !safeEqual(createHash('sha256').update(verifier).digest('base64url'), row.codeChallenge)) {
      throw invalidGrant('PKCE verification failed')
    }
    // Claiming the code and creating its grant happen in one transaction: nothing (such
    // as a recovery that disconnects every agent) can run between them and miss the grant.
    const grantId = db.transaction((tx) => {
      const claimed = tx
        .update(oauthCodes)
        .set({ usedAt: new Date() })
        .where(and(eq(oauthCodes.id, row.id), isNull(oauthCodes.usedAt)))
        .returning({ id: oauthCodes.id })
        .all()
      if (claimed.length === 0) return null
      const member = tx
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, row.workspaceId), eq(workspaceMembers.userId, row.userId)))
        .get()
      if (!member) return null
      // Reconnecting: the application's earlier access to this workspace ends as the new one starts.
      if (row.replacePrevious) {
        tx.update(apiTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(apiTokens.userId, row.userId), eq(apiTokens.workspaceId, row.workspaceId), eq(apiTokens.oauthClientId, row.clientId), isNull(apiTokens.revokedAt)))
          .run()
      }
      const grant = tx
        .insert(apiTokens)
        .values({
          userId: row.userId,
          workspaceId: row.workspaceId,
          name: row.clientName,
          // Never handed out: the grant is used through its OAuth tokens.
          tokenHash: sha256(randomToken(32)),
          prefix: 'OAuth',
          scopes: row.scopes,
          expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
          oauthClientId: row.clientId,
          oauthRedirectUri: row.redirectUri,
        })
        .returning({ id: apiTokens.id })
        .get()
      tx.update(oauthCodes).set({ tokenId: grant.id }).where(eq(oauthCodes.id, row.id)).run()
      return grant.id
    })
    if (!grantId) throw invalidGrant()
    return this.issue(grantId, row.scopes)
  }

  private async refresh(form: Record<string, string>) {
    const token = form.refresh_token
    if (!token?.startsWith(REFRESH_PREFIX) || token.length > 100) throw invalidGrant()
    const db = this.deps.db
    const now = new Date()
    const [row] = await db
      .select({ token: oauthTokens, grant: apiTokens })
      .from(oauthTokens)
      .innerJoin(apiTokens, eq(apiTokens.id, oauthTokens.tokenId))
      .where(and(eq(oauthTokens.id, sha256(token)), eq(oauthTokens.kind, 'refresh')))
    if (!row || (form.client_id && form.client_id !== row.grant.oauthClientId)) throw invalidGrant()
    if (row.token.rotatedAt) {
      // Someone else holds a copy of this refresh token: neither copy may keep the access.
      await this.revokeGrant(row.grant.id)
      throw invalidGrant('This refresh token was already used, so the access has been revoked')
    }
    const { grant } = row
    if (row.token.expiresAt <= now || grant.revokedAt || (grant.expiresAt && grant.expiresAt <= now)) throw invalidGrant()
    if (form.scope && !form.scope.split(' ').filter(Boolean).every((scope) => grant.scopes.includes(scope))) {
      throw new OAuthError('invalid_scope', 'The requested scope exceeds what was granted')
    }
    if (!(await this.member(grant.userId, grant.workspaceId))) throw invalidGrant()
    const [rotated] = await db
      .update(oauthTokens)
      .set({ rotatedAt: now })
      .where(and(eq(oauthTokens.id, row.token.id), isNull(oauthTokens.rotatedAt)))
      .returning({ id: oauthTokens.id })
    if (!rotated) {
      // Another request exchanged this refresh token at the same moment: a replay all the same.
      await this.revokeGrant(grant.id)
      throw invalidGrant('This refresh token was already used, so the access has been revoked')
    }
    await db.update(apiTokens).set({ expiresAt: new Date(now.getTime() + REFRESH_TTL_MS) }).where(eq(apiTokens.id, grant.id))
    return this.issue(grant.id, grant.scopes)
  }

  private async issue(grantId: string, scopes: string[]): Promise<TokenResponse> {
    const now = Date.now()
    const access = `${ACCESS_PREFIX}${randomToken(32)}`
    const refresh = `${REFRESH_PREFIX}${randomToken(32)}`
    const db = this.deps.db
    await db
      .delete(oauthTokens)
      .where(and(eq(oauthTokens.tokenId, grantId), or(lt(oauthTokens.expiresAt, new Date(now)), lt(oauthTokens.rotatedAt, new Date(now - ROTATED_KEPT_MS)))))
    await db.insert(oauthTokens).values([
      { id: sha256(access), tokenId: grantId, kind: 'access', expiresAt: new Date(now + ACCESS_TTL_MS) },
      { id: sha256(refresh), tokenId: grantId, kind: 'refresh', expiresAt: new Date(now + REFRESH_TTL_MS) },
    ])
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh, scope: scopes.join(' ') }
  }

  /** Token revocation (RFC 7009): a refresh token ends the whole grant, an access token only itself. */
  async revoke(token: string) {
    if (token.length > 100) return
    if (token.startsWith(REFRESH_PREFIX)) {
      const [row] = await this.deps.db.select({ grant: oauthTokens.tokenId }).from(oauthTokens).where(and(eq(oauthTokens.id, sha256(token)), eq(oauthTokens.kind, 'refresh')))
      if (row) await this.revokeGrant(row.grant)
    } else if (token.startsWith(ACCESS_PREFIX)) {
      await this.deps.db.delete(oauthTokens).where(and(eq(oauthTokens.id, sha256(token)), eq(oauthTokens.kind, 'access')))
    }
  }

  /** Resolves an OAuth access token into the grant's agent actor; null if invalid, expired or revoked. */
  async authenticate(token: string): Promise<AgentActor | null> {
    if (!token.startsWith(ACCESS_PREFIX) || token.length > 100) return null
    const now = new Date()
    const [row] = await this.deps.db
      .select({ grant: apiTokens })
      .from(oauthTokens)
      .innerJoin(apiTokens, eq(apiTokens.id, oauthTokens.tokenId))
      .innerJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, apiTokens.workspaceId), eq(workspaceMembers.userId, apiTokens.userId)))
      .where(
        and(
          eq(oauthTokens.id, sha256(token)),
          eq(oauthTokens.kind, 'access'),
          gt(oauthTokens.expiresAt, now),
          isNull(apiTokens.revokedAt),
          or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
        ),
      )
      .limit(1)
    return row ? this.tokens.actorFor(row.grant, now) : null
  }

  private async revokeGrant(tokenId: string) {
    await this.deps.db.update(apiTokens).set({ revokedAt: new Date() }).where(and(eq(apiTokens.id, tokenId), isNull(apiTokens.revokedAt)))
  }

  private async member(userId: string, workspaceId: string) {
    const [row] = await this.deps.db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    return Boolean(row)
  }
}
