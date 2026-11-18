import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { BackupDTO } from '@orqevio/shared'
import { afterAll, describe, expect, it } from 'vitest'
import { Client, type Harness, ORIGIN, createHarness, signUp } from './harness'

const harnesses: Harness[] = []
const folders: string[] = []
async function copy(overrides: Parameters<typeof createHarness>[0] = {}) {
  const h = await createHarness(overrides)
  harnesses.push(h)
  return h
}
afterAll(async () => {
  for (const h of harnesses) await h.close()
  for (const dir of folders) await rm(dir, { recursive: true, force: true })
})

const keys = (n: number) => ({
  kdf: { algorithm: 'argon2id', salt: 'c2FsdHNhbHRzYWx0c2FsdA', memoryKiB: 65536, iterations: 3, parallelism: 1 },
  wrappedKey: `v1.aXZpdml2aXZpdml2.a2V5${n}`,
  recoveryWrappedKey: `v1.aXZpdml2aXZpdml2.cmVj${n}`,
})
const item = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

async function agent(client: Client, workspaceId: string, name: string) {
  const res = await client.post('/api/tokens', { name, workspaceId, scopes: ['tasks:read'], expiresInDays: 30 })
  expect(res.status).toBe(201)
  return { id: res.body.id as string, token: res.body.token as string }
}
const works = async (h: Harness, token: string, workspaceId: string) => (await new Client(h, token).get(`/api/workspaces/${workspaceId}/overview`)).status === 200

async function backup(client: Client) {
  const made = await client.post('/api/backups')
  expect(made.status).toBe(201)
  return made.body as BackupDTO
}
async function restore(client: Client, id: string, accessKey: string) {
  const res = await client.post(`/api/backups/${id}/restore`, { accessKey })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
}

// OAuth as a client like Claude does it: registration, consent, code exchange and refresh.
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'
async function form(h: Harness, url: string, body: Record<string, string>) {
  const res = await h.app.request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
async function connectApp(h: Harness, owner: Client, workspaceId: string) {
  const reg = await h.app.request('/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: 'none' }),
  })
  const clientId = ((await reg.json()) as { client_id: string }).client_id
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const params = { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 's', scope: 'tasks:read', resource: `${ORIGIN}/mcp` }
  const decision = await owner.post('/api/oauth/decision', { params, allow: true, workspaceId, scopes: ['tasks:read'] })
  const code = new URL(decision.body.redirect).searchParams.get('code')!
  const res = await form(h, '/oauth/token', { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT, resource: `${ORIGIN}/mcp` })
  expect(res.status).toBe(200)
  return { clientId, access: res.body.access_token as string, refresh: res.body.refresh_token as string }
}
const refresh = (h: Harness, clientId: string, token: string) => form(h, '/oauth/token', { grant_type: 'refresh_token', refresh_token: token, client_id: clientId })

describe('restoring a backup', () => {
  it('keeps revoked the agents revoked since it was made, an intruder’s after recovering access included', async () => {
    const h = await copy()
    const { client, workspaceId, accessKey: key0 } = await signUp(h)
    const accessKey = key0!
    const revokedLater = await agent(client, workspaceId, 'Revocado después')
    const intruder = await agent(client, workspaceId, 'Intruso')
    const made = await backup(client)

    // After the backup: one access revoked by hand, and the copy recovered "because someone else may have it".
    expect((await client.del(`/api/tokens/${revokedLater.id}`)).status).toBe(204)
    h.env.setupCode = 'stolen-key-setup-code'
    let key = accessKey
    try {
      const recovered = await new Client(h).post('/api/auth/recover', { setupCode: 'stolen-key-setup-code', reason: 'compromised' })
      expect(recovered.status).toBe(200)
      key = recovered.body.accessKey as string
      h.owner!.accessKey = key
    } finally {
      h.env.setupCode = 'test-setup-code-1234'
    }
    expect(await works(h, intruder.token, workspaceId)).toBe(false)
    // A new one after recovering: it did not exist when the backup was made.
    const owner = new Client(h)
    expect((await owner.post('/api/auth/login', { accessKey: key })).status).toBe(200)
    const newer = await agent(owner, workspaceId, 'Nuevo')

    await restore(owner, made.id, key)

    expect(await works(h, revokedLater.token, workspaceId)).toBe(false)
    expect(await works(h, intruder.token, workspaceId)).toBe(false)
    // Restoring takes the copy back to the backup: an access made later is not in it.
    expect(await works(h, newer.token, workspaceId)).toBe(false)
    const tokens = (await owner.get('/api/tokens')).body as Array<{ name: string; revokedAt: string | null }>
    expect(tokens.map((t) => [t.name, t.revokedAt !== null]).sort()).toEqual([
      ['Intruso', true],
      ['Revocado después', true],
    ])
  })

  it('brings back as they were the agents never revoked since, and the access key in use now still opens it', async () => {
    const h = await copy()
    const { client, workspaceId, accessKey: key0 } = await signUp(h)
    const accessKey = key0!
    const kept = await agent(client, workspaceId, 'Claude')
    const made = await backup(client)
    await client.patch(`/api/workspaces/${workspaceId}`, { name: 'Otro nombre' })
    await restore(client, made.id, accessKey)
    expect(await works(h, kept.token, workspaceId)).toBe(true)
  })

  it('keeps an OAuth access revoked since revoked, and a refresh token exchanged since used', async () => {
    const h = await copy()
    const { client, workspaceId, accessKey: key0 } = await signUp(h)
    const accessKey = key0!
    const revokedLater = await connectApp(h, client, workspaceId)
    const refreshedLater = await connectApp(h, client, workspaceId)
    const made = await backup(client)

    const grants = (await client.get('/api/tokens')).body as Array<{ id: string; createdAt: string }>
    const grant = grants.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]!
    expect((await client.del(`/api/tokens/${grant.id}`)).status).toBe(204)
    const next = await refresh(h, refreshedLater.clientId, refreshedLater.refresh)
    expect(next.status).toBe(200)

    await restore(client, made.id, accessKey)

    // The revoked access: neither its access token nor its refresh token work.
    expect(await works(h, revokedLater.access, workspaceId)).toBe(false)
    expect((await refresh(h, revokedLater.clientId, revokedLater.refresh)).status).toBe(400)
    // The refresh token already exchanged is refused, as a replay: that ends the grant, as it would have without restoring.
    expect((await refresh(h, refreshedLater.clientId, refreshedLater.refresh)).status).toBe(400)
    expect(await works(h, refreshedLater.access, workspaceId)).toBe(false)
  })

  it('never hands out a vault key version twice, so a tab holding a newer key is refused', async () => {
    const h = await copy()
    const { client, accessKey: key0 } = await signUp(h)
    const accessKey = key0!
    expect((await client.post('/api/vault/setup', keys(1))).body.keyVersion).toBe(1)
    expect((await client.put(`/api/vault/items/${item(1)}`, { data: 'v1.aXZpdml2aXZpdml2.b25l', keyVersion: 1 })).status).toBe(200)
    const made = await backup(client)

    // Reset and set up again: a tab unlocks the vault with key 2.
    expect((await client.post('/api/vault/reset', { accessKey })).status).toBe(204)
    expect((await client.post('/api/vault/setup', keys(2))).body.keyVersion).toBe(2)

    await restore(client, made.id, accessKey)

    // The vault is back with its key of then, under a version never used before.
    const state = (await client.get('/api/vault')).body
    expect(state).toMatchObject({ initialized: true, keyVersion: 3 })
    expect((await client.get('/api/vault/items')).body).toHaveLength(1)
    // The tab still holding key 2 is refused, and so is anyone after resetting and setting up again.
    const stale = await client.put(`/api/vault/items/${item(2)}`, { data: 'v1.aXZpdml2aXZpdml2.dHdv', keyVersion: 2 })
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('vault_key_changed')
    expect((await client.put(`/api/vault/items/${item(3)}`, { data: 'v1.aXZpdml2aXZpdml2.dGhyZWU', keyVersion: 3 })).status).toBe(200)
    expect((await client.post('/api/vault/reset', { accessKey })).status).toBe(204)
    expect((await client.post('/api/vault/setup', keys(4))).body.keyVersion).toBe(4)
  })

  it('keeps the vault key version when the vault is the same as in the backup', async () => {
    const h = await copy()
    const { client, accessKey: key0 } = await signUp(h)
    const accessKey = key0!
    await client.post('/api/vault/setup', keys(1))
    const made = await backup(client)
    await restore(client, made.id, accessKey)
    expect((await client.get('/api/vault')).body.keyVersion).toBe(1)
    expect((await client.put(`/api/vault/items/${item(1)}`, { data: 'v1.aXZpdml2aXZpdml2.b25l', keyVersion: 1 })).status).toBe(200)
  })

  it('brings a backup of another copy back as it was, its agents included', async () => {
    const shared = await mkdtemp(path.join(tmpdir(), 'orqevio-restore-kept-'))
    folders.push(shared)
    const before = await copy({ backupDir: shared })
    const old = await signUp(before, 'Lucía Martín')
    const kept = await agent(old.client, old.workspaceId, 'Claude')
    await backup(old.client)

    // Another copy (a new server, say) with the same backups folder, claimed by its owner.
    const after = await copy({ backupDir: shared })
    const now = await signUp(after, 'Lucía Martín')
    const [made] = (await now.client.get('/api/backups')).body.backups as BackupDTO[]
    await restore(now.client, made!.id, now.accessKey!)
    expect(await works(after, kept.token, old.workspaceId)).toBe(true)
  })
})
