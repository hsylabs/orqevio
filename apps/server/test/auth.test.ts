import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { sha256 } from '../src/auth/crypto'
import { apiTokens, instance, oauthCodes } from '../src/db/schema'
import { Client, type Harness, SETUP_CODE, createHarness, signInOwner, signUp } from './harness'

const KEY_FORMAT = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => h.close())

describe('access to a copy', () => {
  it('starts unclaimed and refuses to sign in', async () => {
    const client = new Client(h)
    const session = await client.get('/api/auth/session')
    expect(session.status).toBe(200)
    // How the copy was installed comes too: the sign-in page gives the recovery steps that apply.
    expect(session.body).toEqual({ user: null, workspaces: [], claimed: false, recoverable: false, install: 'source', copyName: null })
    const login = await client.post('/api/auth/login', { accessKey: 'AAAA-BBBB' })
    expect(login.status).toBe(409)
    expect(login.body.error.code).toBe('not_claimed')
    expect((await client.get('/api/auth/me')).status).toBe(401)
  })

  it('needs the setup code to be claimed', async () => {
    const client = new Client(h)
    const wrong = await client.post('/api/auth/claim', { setupCode: 'not-the-code', name: 'Marta Ruiz' })
    expect(wrong.status).toBe(403)
    expect(wrong.body.error.code).toBe('invalid_setup_code')
    expect((await client.post('/api/auth/claim', { setupCode: SETUP_CODE, name: '' })).status).toBe(400)
    expect((await client.get('/api/auth/session')).body.claimed).toBe(false)
  })

  it('claims once: creates the owner, a workspace, a hardened cookie and a one-time access key', async () => {
    const client = new Client(h)
    // Case, spaces and dashes in the setup code do not matter.
    // The language the claim screen was shown in becomes the owner's, and names the first workspace.
    const res = await client.post('/api/auth/claim', { setupCode: ` ${SETUP_CODE.toUpperCase().replaceAll('-', ' ')} `, name: 'Marta Ruiz', locale: 'es' })
    expect(res.status).toBe(201)
    expect(res.body.user.name).toBe('Marta Ruiz')
    expect(res.body.user.locale).toBe('es')
    expect(res.body.user).not.toHaveProperty('email')
    expect(res.body.accessKey).toMatch(KEY_FORMAT)
    const cookie = res.headers.get('set-cookie')!
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    const me = await client.get('/api/auth/me')
    expect(me.body.workspaces).toHaveLength(1)
    expect(me.body.workspaces[0].name).toBe('Espacio de Marta')
    expect(me.body.limits).toEqual({ maxUploadBytes: h.env.maxUploadBytes })
    h.owner = { accessKey: res.body.accessKey, userId: me.body.user.id, workspaceId: me.body.workspaces[0].id }

    const again = await new Client(h).post('/api/auth/claim', { setupCode: SETUP_CODE, name: 'Intrusa' })
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('already_claimed')
    expect((await new Client(h).get('/api/auth/session')).body).toMatchObject({ user: null, claimed: true, recoverable: false })
  })

  it('signs in with the access key only', async () => {
    const client = new Client(h)
    const wrong = await client.post('/api/auth/login', { accessKey: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ' })
    expect(wrong.status).toBe(401)
    expect(wrong.body.error.code).toBe('invalid_access_key')
    // Lowercase and without dashes still works.
    const good = await client.post('/api/auth/login', { accessKey: h.owner!.accessKey.toLowerCase().replaceAll('-', '') })
    expect(good.status).toBe(200)
    expect(good.body.user.name).toBe('Marta Ruiz')
    expect((await client.get('/api/auth/me')).status).toBe(200)
  })

  it('requires authentication and logs out', async () => {
    const { client } = await signInOwner(h)
    expect((await client.post('/api/auth/logout')).status).toBe(204)
    expect((await client.get('/api/auth/me')).status).toBe(401)
  })

  it('blocks cross-origin state-changing requests', async () => {
    const { client, workspaceId } = await signInOwner(h)
    const res = await client.request('POST', `/api/workspaces/${workspaceId}/projects`, { name: 'X' }, { Origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('bad_origin')
  })

  it('changes the language of the account and refuses unknown ones', async () => {
    const { client } = await signInOwner(h)
    expect((await client.patch('/api/account', { locale: 'de' })).body.locale).toBe('de')
    expect((await client.get('/api/auth/me')).body.user.locale).toBe('de')
    const unknown = await client.patch('/api/account', { locale: 'xx' })
    expect(unknown.status).toBe(400)
    expect((await client.patch('/api/account', { locale: 'es' })).body.locale).toBe('es')
  })

  it('replaces the access key and signs out the other sessions', async () => {
    const { client } = await signInOwner(h)
    const other = (await signInOwner(h)).client
    const oldKey = h.owner!.accessKey
    const wrong = await client.post('/api/account/access-key', { currentAccessKey: 'ZZZZ-ZZZZ' })
    expect(wrong.status).toBe(403)
    expect(wrong.body.error.code).toBe('invalid_access_key')
    const res = await client.post('/api/account/access-key', { currentAccessKey: oldKey })
    expect(res.status).toBe(200)
    expect(res.body.accessKey).toMatch(KEY_FORMAT)
    expect(res.body.accessKey).not.toBe(oldKey)
    expect((await client.get('/api/auth/me')).status).toBe(200)
    expect((await other.get('/api/auth/me')).status).toBe(401)
    expect((await new Client(h).post('/api/auth/login', { accessKey: oldKey })).status).toBe(401)
    expect((await new Client(h).post('/api/auth/login', { accessKey: res.body.accessKey })).status).toBe(200)
    h.owner!.accessKey = res.body.accessKey
  })

  it('recovers access only after the setup code is changed', async () => {
    const { client } = await signInOwner(h)
    const anonymous = new Client(h)
    expect((await anonymous.post('/api/auth/recover', { setupCode: SETUP_CODE, reason: 'lost' })).status).toBe(403)

    h.env.setupCode = 'a-brand-new-setup-code'
    try {
      expect((await anonymous.get('/api/auth/session')).body.recoverable).toBe(true)
      expect((await anonymous.post('/api/auth/recover', { setupCode: SETUP_CODE, reason: 'lost' })).status).toBe(403)
      const res = await anonymous.post('/api/auth/recover', { setupCode: 'A BRAND NEW SETUP CODE', reason: 'lost' })
      expect(res.status).toBe(200)
      expect(res.body.accessKey).toMatch(KEY_FORMAT)
      expect((await anonymous.get('/api/auth/me')).status).toBe(200)
      // Every earlier session is signed out, and the same code cannot be used twice.
      expect((await client.get('/api/auth/me')).status).toBe(401)
      expect((await new Client(h).get('/api/auth/session')).body.recoverable).toBe(false)
      expect((await new Client(h).post('/api/auth/recover', { setupCode: 'a-brand-new-setup-code', reason: 'lost' })).status).toBe(403)
      h.owner!.accessKey = res.body.accessKey
    } finally {
      h.env.setupCode = SETUP_CODE
    }
  })

  it('asks why access is recovered, and disconnects every agent when the key may be stolen', async () => {
    const { client, workspaceId } = await signInOwner(h)
    const agent = async (name: string) => {
      const res = await client.post('/api/tokens', { name, workspaceId, scopes: ['tasks:read'], expiresInDays: 30 })
      expect(res.status).toBe(201)
      return res.body.token as string
    }
    const works = async (token: string) => (await new Client(h, token).get(`/api/workspaces/${workspaceId}/overview`)).status === 200
    const recover = (setupCode: string, reason?: string) => new Client(h).post('/api/auth/recover', reason ? { setupCode, reason } : { setupCode })
    const kept = await agent('Claude')
    const { ownerId } = h.db.select({ ownerId: instance.ownerId }).from(instance).get()!
    // An OAuth access (a grant) and a code nobody has exchanged yet.
    const [grant] = h.db
      .insert(apiTokens)
      .values({ userId: ownerId, workspaceId, name: 'Some client', tokenHash: sha256('grant'), prefix: 'OAuth', scopes: ['tasks:read'], oauthClientId: 'https://client.example/meta.json', oauthRedirectUri: 'https://client.example/cb' })
      .returning({ id: apiTokens.id })
      .all()
    h.db
      .insert(oauthCodes)
      .values({ id: sha256('pending-code'), userId: ownerId, workspaceId, clientId: 'https://client.example/meta.json', clientName: 'Some client', redirectUri: 'https://client.example/cb', codeChallenge: 'x', scopes: ['tasks:read'], expiresAt: new Date(Date.now() + 60_000) })
      .run()

    h.env.setupCode = 'lost-key-setup-code'
    try {
      // The answer is required.
      expect((await recover('lost-key-setup-code')).status).toBe(400)
      expect((await recover('lost-key-setup-code', 'forgot')).status).toBe(400)
      const lost = await recover('lost-key-setup-code', 'lost')
      expect(lost.status).toBe(200)
      expect(await works(kept)).toBe(true)
      h.owner!.accessKey = lost.body.accessKey

      h.env.setupCode = 'stolen-key-setup-code'
      const stolen = await recover('stolen-key-setup-code', 'compromised')
      expect(stolen.status).toBe(200)
      h.owner!.accessKey = stolen.body.accessKey
      expect(await works(kept)).toBe(false)
      expect(h.db.select().from(apiTokens).where(eq(apiTokens.id, grant!.id)).get()!.revokedAt).not.toBeNull()
      expect(h.db.select().from(oauthCodes).where(eq(oauthCodes.id, sha256('pending-code'))).get()).toBeUndefined()
      // In the app, the agents show up as revoked.
      const signedIn = new Client(h)
      await signedIn.post('/api/auth/login', { accessKey: stolen.body.accessKey })
      const tokens = (await signedIn.get('/api/tokens')).body as Array<{ revokedAt: string | null }>
      expect(tokens.length).toBeGreaterThan(0)
      expect(tokens.every((t) => t.revokedAt)).toBe(true)
    } finally {
      h.env.setupCode = SETUP_CODE
    }
  })

  it('lets only one of two simultaneous recoveries with the same code succeed', async () => {
    h.env.setupCode = 'another-new-setup-code'
    try {
      const [a, b] = await Promise.all([
        new Client(h).post('/api/auth/recover', { setupCode: 'another-new-setup-code', reason: 'lost' }),
        new Client(h).post('/api/auth/recover', { setupCode: 'another-new-setup-code', reason: 'lost' }),
      ])
      expect([a.status, b.status].sort()).toEqual([200, 403])
      const winner = a.status === 200 ? a : b
      expect((await new Client(h).post('/api/auth/login', { accessKey: winner.body.accessKey })).status).toBe(200)
      h.owner!.accessKey = winner.body.accessKey
    } finally {
      h.env.setupCode = SETUP_CODE
    }
  })

  it('isolates workspaces between users', async () => {
    const a = await signUp(h, 'Persona A')
    const b = await signUp(h, 'Persona B')
    expect((await b.client.get(`/api/workspaces/${a.workspaceId}/overview`)).status).toBe(404)
    expect((await b.client.get('/api/cards/00000000-0000-4000-8000-000000000000')).status).toBe(404)
    expect((await b.client.get('/api/cards/not-a-uuid')).status).toBe(404)
  })

  it('sends security headers', async () => {
    const res = await h.app.request('/healthz')
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })

  it('deleting the copy needs the access key and leaves it ready to be claimed again', async () => {
    const { client, accessKey } = await signInOwner(h)
    expect((await client.post('/api/account/delete', { accessKey: 'ZZZZ-ZZZZ' })).status).toBe(403)
    expect((await client.post('/api/account/delete', { accessKey })).status).toBe(204)
    expect((await new Client(h).get('/api/auth/session')).body).toMatchObject({ user: null, claimed: false })
    h.owner = null
    const { workspaceId } = await signUp(h, 'Nueva Dueña')
    expect(workspaceId).toBeTruthy()
  })

  it('without SETUP_CODE, a new one-off code is issued when the copy becomes unclaimed again', async () => {
    const { client, accessKey } = await signInOwner(h)
    h.env.setupCode = null
    try {
      expect((await client.post('/api/account/delete', { accessKey })).status).toBe(204)
      h.owner = null
      const notice = await h.services.accounts.setupNotice()
      expect(notice?.generatedCode).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/)
      const claim = await new Client(h).post('/api/auth/claim', { setupCode: notice!.generatedCode, name: 'Otra Dueña' })
      expect(claim.status).toBe(201)
      h.owner = { accessKey: claim.body.accessKey, userId: claim.body.user.id, workspaceId: '' }
    } finally {
      h.env.setupCode = SETUP_CODE
    }
  })

  it('slows down repeated sign-in attempts', async () => {
    const client = new Client(h)
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) statuses.push((await client.post('/api/auth/login', { accessKey: `WRONG-${i}` })).status)
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true)
    expect(statuses[10]).toBe(429)
  })
})
