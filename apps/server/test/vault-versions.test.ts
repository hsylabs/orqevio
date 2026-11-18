import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Client, type Harness, createHarness, signUp } from './harness'

let h: Harness
let client: Client
beforeAll(async () => {
  h = await createHarness()
  ;({ client } = await signUp(h))
  await client.post('/api/vault/setup', {
    kdf: { algorithm: 'argon2id', salt: 'c2FsdHNhbHRzYWx0c2FsdA', memoryKiB: 65536, iterations: 3, parallelism: 1 },
    wrappedKey: 'v1.aXZpdml2aXZpdml2.a2V5',
    recoveryWrappedKey: 'v1.aXZpdml2aXZpdml2.cmVj',
  })
})
afterAll(async () => h.close())

const data = (n: number) => `v1.aXZpdml2aXZpdml2.${Buffer.from(`item-${n}`).toString('base64url')}`
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const save = (n: number, body: Record<string, unknown>) => client.put(`/api/vault/items/${id(n)}`, { keyVersion: 1, ...body })
const items = async () => (await client.get('/api/vault/items')).body as Array<{ id: string; data: string; updatedAt: string }>

describe('vault items saved from more than one tab or device', () => {
  it('refuses a save from a tab that has an older version, and keeps the newer one', async () => {
    const first = await save(1, { data: data(1), baseUpdatedAt: null })
    expect(first.status).toBe(200)
    // Tab A saves a new password.
    const a = await save(1, { data: data(2), baseUpdatedAt: first.body.updatedAt })
    expect(a.status).toBe(200)
    expect(a.body.updatedAt > first.body.updatedAt).toBe(true)
    // Tab B, which still shows the old one, marks it as a favourite.
    const b = await save(1, { data: data(3), baseUpdatedAt: first.body.updatedAt })
    expect(b.status).toBe(409)
    expect(b.body.error.code).toBe('vault_item_changed')
    expect((await items()).find((i) => i.id === id(1))!.data).toBe(data(2))
  })

  it('refuses to bring back an item deleted in another tab, and to delete one changed since', async () => {
    const first = (await save(2, { data: data(1), baseUpdatedAt: null })).body.updatedAt as string
    const second = (await save(2, { data: data(2), baseUpdatedAt: first })).body.updatedAt as string
    const stale = await client.del(`/api/vault/items/${id(2)}?base=${encodeURIComponent(first)}`)
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('vault_item_changed')
    expect((await items()).some((i) => i.id === id(2))).toBe(true)

    expect((await client.del(`/api/vault/items/${id(2)}?base=${encodeURIComponent(second)}`)).status).toBe(204)
    // A tab that still has it saves it again: it doesn't come back.
    const back = await save(2, { data: data(3), baseUpdatedAt: second })
    expect(back.status).toBe(409)
    expect((await items()).some((i) => i.id === id(2))).toBe(false)
  })

  it('refuses a new item whose id is taken, and gives each save a later version, even within a millisecond', async () => {
    await save(3, { data: data(1), baseUpdatedAt: null })
    expect((await save(3, { data: data(2), baseUpdatedAt: null })).status).toBe(409)
    let version = (await items()).find((i) => i.id === id(3))!.updatedAt
    for (let n = 0; n < 5; n++) {
      const next = await save(3, { data: data(n), baseUpdatedAt: version })
      expect(next.status).toBe(200)
      expect(next.body.updatedAt > version).toBe(true)
      version = next.body.updatedAt
    }
  })

  it('still takes saves and deletes without a version, from tabs opened before 1.2.1', async () => {
    expect((await save(4, { data: data(1) })).status).toBe(200)
    expect((await save(4, { data: data(2) })).status).toBe(200)
    expect((await client.del(`/api/vault/items/${id(4)}`)).status).toBe(204)
  })
})
