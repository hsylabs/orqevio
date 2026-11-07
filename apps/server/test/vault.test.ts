import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, type Harness, createHarness, signUp } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => h.close())

const keys = {
  kdf: { algorithm: 'argon2id', salt: 'c2FsdHNhbHRzYWx0c2FsdA', memoryKiB: 65536, iterations: 3, parallelism: 1 },
  wrappedKey: 'v1.aXZpdml2aXZpdml2.Y2lwaGVydGV4dA',
  recoveryWrappedKey: 'v1.aXZpdml2aXZpdml2.cmVjb3Zlcnk',
}

describe('vault', () => {
  it('stores only opaque envelopes and supports re-keying', async () => {
    const { client } = await signUp(h)
    expect((await client.get('/api/vault')).body.initialized).toBe(false)
    expect((await client.put('/api/vault/items/7d1d9b52-5f39-4c43-a43e-36d9c3f06a10', { data: 'v1.YQ.Yg' })).status).toBe(409)
    expect((await client.post('/api/vault/setup', keys)).status).toBe(204)
    expect((await client.post('/api/vault/setup', keys)).status).toBe(409)
    const state = await client.get('/api/vault')
    expect(state.body).toMatchObject({ initialized: true, wrappedKey: keys.wrappedKey, autoLockMinutes: 15 })

    const id = '7d1d9b52-5f39-4c43-a43e-36d9c3f06a10'
    expect((await client.put(`/api/vault/items/${id}`, { data: 'plaintext password' })).status).toBe(400)
    expect((await client.put(`/api/vault/items/${id}`, { data: 'v1.aXY.Y3Q' })).status).toBe(200)
    expect((await client.get('/api/vault/items')).body).toEqual([expect.objectContaining({ id, data: 'v1.aXY.Y3Q' })])

    const rekeyed = { ...keys, wrappedKey: 'v1.bmV3aXY.bmV3Y3Q' }
    expect((await client.put('/api/vault/keys', rekeyed)).status).toBe(204)
    expect((await client.get('/api/vault')).body.wrappedKey).toBe(rekeyed.wrappedKey)
    expect((await client.patch('/api/vault/settings', { autoLockMinutes: 5 })).status).toBe(204)
    expect((await client.get('/api/vault')).body.autoLockMinutes).toBe(5)
  })

  it('keeps items private per user', async () => {
    const a = await signUp(h)
    const b = await signUp(h)
    await a.client.post('/api/vault/setup', keys)
    await b.client.post('/api/vault/setup', keys)
    const id = '9a6c4a4e-0f7e-4f0e-9a3c-4a7f0d3e2b11'
    await a.client.put(`/api/vault/items/${id}`, { data: 'v1.YQ.YQ' })
    expect((await b.client.put(`/api/vault/items/${id}`, { data: 'v1.Yg.Yg' })).status).toBe(404)
    expect((await b.client.del(`/api/vault/items/${id}`)).status).toBe(404)
    expect((await b.client.get('/api/vault/items')).body).toEqual([])
    expect((await a.client.get('/api/vault/items')).body[0].data).toBe('v1.YQ.YQ')
  })

  it('requires the account password to reset', async () => {
    const { client } = await signUp(h)
    await client.post('/api/vault/setup', keys)
    expect((await client.post('/api/vault/reset', { password: 'wrong-password' })).status).toBe(403)
    expect((await client.post('/api/vault/reset', { password: 'correct-horse-battery' })).status).toBe(204)
    expect((await client.get('/api/vault')).body.initialized).toBe(false)
  })

  it('is unreachable with agent tokens, even with every scope', async () => {
    const { client, workspaceId } = await signUp(h)
    await client.post('/api/vault/setup', keys)
    const token = await client.post('/api/tokens', {
      name: 'All scopes',
      workspaceId,
      scopes: ['tasks:read', 'tasks:write', 'docs:read', 'docs:write'],
      expiresInDays: null,
    })
    const agent = new Client(h, token.body.token)
    for (const [method, url] of [
      ['GET', '/api/vault'],
      ['GET', '/api/vault/items'],
      ['PUT', '/api/vault/keys'],
      ['POST', '/api/vault/reset'],
    ] as const) {
      const res = await agent.request(method, url, method === 'GET' ? undefined : keys)
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('vault_isolated')
    }
    // Even combined with a valid session cookie, an Authorization header is refused.
    const mixed = await client.request('GET', '/api/vault', undefined, { Authorization: `Bearer ${token.body.token}` })
    expect(mixed.status).toBe(403)
  })
})
