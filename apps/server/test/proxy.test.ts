import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ConfigError, configWarnings, loadEnv, parseAppUrls, parseTrustProxy } from '../src/env'
import { forwardedClient } from '../src/http/client-ip'
import { Client, type Harness, ORIGIN, SETUP_CODE, createHarness, signUp } from './harness'

// A reverse proxy in front of the copy: one that asks for a password of its own, one that says
// who the visitor is in X-Forwarded-For, and the limits on failed attempts behind it.

const basic = `Basic ${Buffer.from('ana:proxy-password').toString('base64')}`

describe('behind a proxy that asks for a password', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createHarness()
  })
  afterAll(async () => h.close())

  it('leaves the proxy’s credentials alone: the copy is claimed, used and its vault opened as usual', async () => {
    const client = new Client(h)
    const session = await client.request('GET', '/api/auth/session', undefined, { Authorization: basic })
    expect(session.status).toBe(200)
    expect(session.body.claimed).toBe(false)
    const claimed = await client.request('POST', '/api/auth/claim', { setupCode: SETUP_CODE, name: 'Ana' }, { Authorization: basic })
    expect(claimed.status, JSON.stringify(claimed.body)).toBe(201)
    const me = await client.request('GET', '/api/auth/me', undefined, { Authorization: basic })
    expect(me.status).toBe(200)
    expect((await client.request('GET', '/api/vault', undefined, { Authorization: basic })).status).toBe(200)
    h.owner = { accessKey: claimed.body.accessKey, userId: me.body.user.id, workspaceId: me.body.workspaces[0].id }
  })

  it('still checks where cookie requests come from, and still refuses tokens in the vault', async () => {
    const { client, workspaceId } = await signUp(h, 'Otra')
    const crossSite = await client.request('POST', '/api/workspaces', { name: 'Ajeno' }, { Authorization: basic, Origin: 'https://evil.example' })
    expect(crossSite.status).toBe(403)
    expect(crossSite.body.error.code).toBe('bad_origin')

    const token = await client.post('/api/tokens', { name: 'Agente', workspaceId, scopes: ['tasks:read'], expiresInDays: null })
    const inVault = await client.request('GET', '/api/vault', undefined, { Authorization: `Bearer ${token.body.token}` })
    expect(inVault.status).toBe(403)
    expect(inVault.body.error.code).toBe('vault_isolated')
    // A Bearer header without a token is a broken token, not a missing one.
    const broken = await new Client(h).request('GET', '/api/auth/me', undefined, { Authorization: 'Bearer' })
    expect(broken.status).toBe(401)
    expect(broken.body.error.code).toBe('invalid_token')
  })
})

describe('the visitor’s address behind trusted proxies', () => {
  it('is the one the last trusted proxy added, never what the visitor wrote before it', () => {
    expect(forwardedClient('6.6.6.6, 203.0.113.7', 1)).toBe('203.0.113.7')
    expect(forwardedClient('6.6.6.6, 203.0.113.7, 10.0.0.2', 2)).toBe('203.0.113.7')
    expect(forwardedClient(' 203.0.113.7 ', 1)).toBe('203.0.113.7')
    // Through fewer proxies than trusted, or none trusted: nothing to go by.
    expect(forwardedClient('203.0.113.7', 2)).toBeUndefined()
    expect(forwardedClient('203.0.113.7', 0)).toBeUndefined()
    expect(forwardedClient(undefined, 1)).toBeUndefined()
  })

  it('counts failed sign-ins per visitor, however X-Forwarded-For is forged', async () => {
    const h = await createHarness({ trustProxy: 1 })
    try {
      await signUp(h)
      const attempt = (forwarded: string) => new Client(h).request('POST', '/api/auth/login', { accessKey: 'WRONG' }, { 'X-Forwarded-For': forwarded })
      const statuses: number[] = []
      // A new forged address each time, but always through the proxy from the same place.
      for (let i = 0; i < 11; i++) statuses.push((await attempt(`198.51.100.${i}, 203.0.113.7`)).status)
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true)
      expect(statuses[10]).toBe(429)
      // Someone else behind the same proxy is not locked out.
      expect((await attempt('203.0.113.8')).status).toBe(401)
    } finally {
      await h.close()
    }
  })
})

describe('limits on failed attempts', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createHarness()
    await signUp(h)
  })
  afterAll(async () => h.close())

  it('keeps one count each for uninstalling, recovering and claiming, and says when to try again', async () => {
    const client = new Client(h)
    let last = await client.post('/api/uninstall', { token: 'not-the-installer' })
    for (let i = 0; i < 10; i++) last = await client.post('/api/uninstall', { token: 'not-the-installer' })
    expect(last.status).toBe(429)
    expect(last.body.error.code).toBe('rate_limited')
    const wait = Number(last.headers.get('retry-after'))
    expect(wait).toBeGreaterThan(3500)
    expect(wait).toBeLessThanOrEqual(3600)

    // The installer's failures never lock the owner out of recovering or claiming.
    const recover = await client.post('/api/auth/recover', { setupCode: 'another-code-1234', reason: 'lost' })
    expect(recover.status).not.toBe(429)
    const claim = await client.post('/api/auth/claim', { setupCode: SETUP_CODE, name: 'Otra' })
    expect(claim.status).not.toBe(429)
  })
})

describe('settings read at startup', () => {
  it('says plainly what is wrong with APP_URL', () => {
    expect(parseAppUrls('https://orqevio.example.com/, http://localhost:3000')).toEqual(['https://orqevio.example.com', 'http://localhost:3000'])
    expect(() => parseAppUrls('orqevio.example.com')).toThrow(ConfigError)
    expect(() => parseAppUrls('orqevio.example.com')).toThrow('APP_URL must be full addresses starting with https:// or http://, such as https://orqevio.example.com (got "orqevio.example.com")')
    expect(() => parseAppUrls('ftp://orqevio.example.com')).toThrow(ConfigError)
    expect(() => parseAppUrls(' , ')).toThrow('APP_URL is empty')
  })

  it('takes TRUST_PROXY as true, false or a number of proxies', () => {
    expect([undefined, '', 'false', 'off', '0'].map(parseTrustProxy)).toEqual([0, 0, 0, 0, 0])
    expect(['true', 'TRUE', 'yes', '1'].map(parseTrustProxy)).toEqual([1, 1, 1, 1])
    expect(parseTrustProxy('2')).toBe(2)
    expect(() => parseTrustProxy('nginx')).toThrow(ConfigError)
  })

  it('warns when the https:// address is not the first one, which decides on secure cookies', () => {
    const env = loadEnv({ appUrls: ['http://192.168.1.10:3000', 'https://orqevio.example.com'], secureCookies: false })
    expect(configWarnings(env, {})).toEqual([expect.stringContaining('Put the https:// one first')])
    expect(configWarnings(env, { SECURE_COOKIES: 'true' })).toEqual([])
    expect(configWarnings(loadEnv({ appUrls: [ORIGIN], secureCookies: false }), {})).toEqual([])
  })
})
