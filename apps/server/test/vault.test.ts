import { MAX_VAULT_ITEMS } from '@orqevio/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, type Harness, createHarness, signInOwner, signUp } from './harness'

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
    expect((await client.put('/api/vault/items/7d1d9b52-5f39-4c43-a43e-36d9c3f06a10', { data: 'v1.YQ.Yg', keyVersion: 0 })).status).toBe(409)
    const setup = await client.post('/api/vault/setup', keys)
    expect(setup.status).toBe(200)
    // The version of the key it set up, given back with the write.
    expect(setup.body).toEqual({ keyVersion: 1, autoLockMinutes: 15 })
    expect((await client.post('/api/vault/setup', keys)).status).toBe(409)
    const state = await client.get('/api/vault')
    expect(state.body).toMatchObject({ initialized: true, wrappedKey: keys.wrappedKey, autoLockMinutes: 15, keyVersion: 1 })

    const id = '7d1d9b52-5f39-4c43-a43e-36d9c3f06a10'
    expect((await client.put(`/api/vault/items/${id}`, { data: 'plaintext password', keyVersion: 1 })).status).toBe(400)
    // Which key it was encrypted with is part of every item.
    expect((await client.put(`/api/vault/items/${id}`, { data: 'v1.aXY.Y3Q' })).status).toBe(400)
    expect((await client.put(`/api/vault/items/${id}`, { data: 'v1.aXY.Y3Q', keyVersion: 1 })).status).toBe(200)
    expect((await client.get('/api/vault/items')).body).toEqual([expect.objectContaining({ id, data: 'v1.aXY.Y3Q' })])

    const rekeyed = { ...keys, wrappedKey: 'v1.bmV3aXY.bmV3Y3Q', keyVersion: 1 }
    expect((await client.put('/api/vault/keys', rekeyed)).status).toBe(204)
    // A new master password keeps the same vault key, and its version.
    expect((await client.get('/api/vault')).body.keyVersion).toBe(1)
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
    await a.client.put(`/api/vault/items/${id}`, { data: 'v1.YQ.YQ', keyVersion: 1 })
    expect((await b.client.put(`/api/vault/items/${id}`, { data: 'v1.Yg.Yg', keyVersion: 1 })).status).toBe(404)
    expect((await b.client.del(`/api/vault/items/${id}`)).status).toBe(404)
    expect((await b.client.get('/api/vault/items')).body).toEqual([])
    expect((await a.client.get('/api/vault/items')).body[0].data).toBe('v1.YQ.YQ')
  })

  it('requires the access key to reset', async () => {
    const { client, accessKey } = await signInOwner(h)
    await client.post('/api/vault/setup', keys)
    expect((await client.post('/api/vault/reset', { accessKey: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX' })).status).toBe(403)
    // Members without an access key (future invitations) cannot confirm a reset.
    const member = await signUp(h, 'Invitada')
    await member.client.post('/api/vault/setup', keys)
    expect((await member.client.post('/api/vault/reset', { accessKey })).status).toBe(403)
    expect((await client.post('/api/vault/reset', { accessKey: accessKey.toLowerCase() })).status).toBe(204)
    expect((await client.get('/api/vault')).body.initialized).toBe(false)
  })

  it('refuses what a tab encrypted, or wrapped, with a vault key the vault no longer has', async () => {
    const { client, accessKey } = await signInOwner(h)
    await client.post('/api/vault/reset', { accessKey })
    expect((await client.post('/api/vault/setup', keys)).status).toBe(200)
    const first = (await client.get('/api/vault')).body.keyVersion as number
    const kept = 'c3b1f0a2-6d4e-4b8a-9f1c-2e7d5a0b8c41'
    expect((await client.put(`/api/vault/items/${kept}`, { data: 'v1.YQ.YQ', keyVersion: first })).status).toBe(200)

    // Another tab resets the vault and sets it up again: a new vault key, with the next version.
    expect((await client.post('/api/vault/reset', { accessKey })).status).toBe(204)
    expect((await client.get('/api/vault')).body).toMatchObject({ initialized: false, keyVersion: first })
    // Before it is set up again, the tab that opened the old one is told the same: its key is gone.
    for (const refused of [
      await client.put('/api/vault/items/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', { data: 'v1.b2xk.a2V5', keyVersion: first }),
      await client.put('/api/vault/keys', { ...keys, keyVersion: first }),
    ]) {
      expect(refused.status).toBe(409)
      expect(refused.body.error.code).toBe('vault_key_changed')
    }
    const fresh = { ...keys, wrappedKey: 'v1.ZnJlc2g.a2V5', recoveryWrappedKey: 'v1.ZnJlc2g.cmVj' }
    // Set up again: the next version, given back to the tab that did it, and when it locks as it was.
    expect((await client.patch('/api/vault/settings', { autoLockMinutes: 5 })).status).toBe(204)
    expect((await client.post('/api/vault/setup', fresh)).body).toEqual({ keyVersion: first + 1, autoLockMinutes: 5 })
    expect((await client.get('/api/vault')).body.keyVersion).toBe(first + 1)

    // The tab that opened the old vault still holds its key: what it saves nobody could open.
    const orphan = 'f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b'
    const refused = await client.put(`/api/vault/items/${orphan}`, { data: 'v1.b2xk.a2V5', keyVersion: first })
    expect(refused.status).toBe(409)
    expect(refused.body.error.code).toBe('vault_key_changed')
    // Nor can it wrap its old key again, which would put it in place of the new one.
    const rewrap = await client.put('/api/vault/keys', { ...keys, keyVersion: first })
    expect(rewrap.status).toBe(409)
    expect(rewrap.body.error.code).toBe('vault_key_changed')
    expect((await client.get('/api/vault')).body).toMatchObject({ wrappedKey: fresh.wrappedKey, recoveryWrappedKey: fresh.recoveryWrappedKey })
    expect((await client.get('/api/vault/items')).body).toEqual([])

    // With the new key, everything works.
    expect((await client.put(`/api/vault/items/${orphan}`, { data: 'v1.bmV3.a2V5', keyVersion: first + 1 })).status).toBe(200)
    expect((await client.put('/api/vault/keys', { ...fresh, wrappedKey: 'v1.b3RyYQ.Y2xhdmU', keyVersion: first + 1 })).status).toBe(204)
    const [row] = [...h.sql.rows('SELECT key_version FROM vault_items WHERE id = ?', orphan)]
    expect(row).toEqual([first + 1])
  })

  it('holds as many items as its limit, checked on each new one', async () => {
    const { client } = await signUp(h, 'Muchas claves')
    await client.post('/api/vault/setup', keys)
    const userId = (await client.get('/api/auth/me')).body.user.id as string
    const now = Date.now()
    h.sql.run(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
       INSERT INTO vault_items (id, user_id, data, key_version, created_at, updated_at)
       SELECT printf('00000000-0000-4000-8000-%012d', i), ?, 'v1.YQ.YQ', 1, ?, ? FROM n`,
      MAX_VAULT_ITEMS,
      userId,
      now,
      now,
    )
    const extra = await client.put('/api/vault/items/0b0b0b0b-0000-4000-8000-000000000000', { data: 'v1.YQ.YQ', keyVersion: 1 })
    expect(extra.status).toBe(409)
    // Its own code, which the web app explains in the person's language.
    expect(extra.body.error.code).toBe('vault_full')
    expect(extra.body.error.message).toContain(String(MAX_VAULT_ITEMS))
    // Changing one that is there is still fine.
    expect((await client.put('/api/vault/items/00000000-0000-4000-8000-000000000001', { data: 'v1.Yg.Yg', keyVersion: 1 })).status).toBe(200)
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
