import { readdirSync } from 'node:fs'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServices } from '../src/services'
import { LocalStorage } from '../src/lib/storage-local'
import { Client, type Harness, createHarness, seedBoard, signUp } from './harness'

// Uninstalling is final, so it gets a copy of its own.
let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => h.close())

const count = (table: string) => (h.db.get(sql.raw(`select count(*) as n from ${table}`)) as { n: number }).n

describe('uninstalling a copy', () => {
  it('needs the access key, deletes everything and leaves a copy that only says it was uninstalled', async () => {
    const { client, workspaceId, accessKey } = await signUp(h)
    const { projectId, columns } = await seedBoard(client, workspaceId)
    await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Tarea' })
    const page = await client.post(`/api/projects/${projectId}/pages`, { title: 'Notas', content: 'Texto' })
    expect((await client.upload(`/api/pages/${page.body.id}/attachments`, 'hola', { name: 'a.txt', type: 'text/plain' })).status).toBe(201)
    const token = (await client.post('/api/tokens', { name: 'Claude', workspaceId, scopes: ['tasks:read'], expiresInDays: 30 })).body.token as string
    const uploads = path.join(h.env.dataDir, 'uploads')
    expect(readdirSync(uploads).length).toBeGreaterThan(0)

    expect((await client.post('/api/account/uninstall', { accessKey: 'ZZZZ-ZZZZ' })).status).toBe(403)
    const done = await client.post('/api/account/uninstall', { accessKey })
    expect(done.status).toBe(200)
    expect(done.body).toMatchObject({ install: 'source', copyName: null, bucket: null })

    // Nothing is left: rows, search indexes and files.
    for (const table of ['users', 'instance', 'workspaces', 'projects', 'cards', 'pages', 'attachments', 'api_tokens', 'sessions', 'vaults', 'activity', 'cards_fts_map', 'pages_fts_map']) {
      expect(count(table), table).toBe(0)
    }
    expect(readdirSync(uploads)).toEqual([])

    // The copy says it was uninstalled, and refuses everything else, the old setup code included.
    const visitor = new Client(h)
    expect((await visitor.get('/api/auth/session')).body).toMatchObject({ user: null, claimed: false, uninstalled: { install: 'source', copyName: null } })
    expect((await visitor.post('/api/auth/claim', { setupCode: h.env.setupCode, name: 'Otra' })).status).toBe(410)
    expect((await visitor.post('/api/auth/login', { accessKey })).status).toBe(410)
    expect((await client.get('/api/auth/me')).status).toBe(410)
    expect((await new Client(h, token).get(`/api/workspaces/${workspaceId}/overview`)).status).toBe(410)
    expect((await h.app.request('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).status).toBe(410)
    expect((await h.app.request('/.well-known/oauth-authorization-server')).status).toBe(410)
    expect((await h.app.request('/healthz')).status).toBe(200)

    // Still so after a restart, which reads it again from the database.
    const restarted = createServices({ db: h.db, bus: h.bus, env: h.env, storage: new LocalStorage(uploads) })
    expect(await restarted.accounts.uninstalled()).toMatchObject({ install: 'source' })
  })

  it('waits for an upload still being written, so its file goes too, and refuses new ones meanwhile', async () => {
    const other = await createHarness()
    try {
      const { client, workspaceId, accessKey } = await signUp(other)
      const { projectId } = await seedBoard(client, workspaceId)
      const page = await client.post(`/api/projects/${projectId}/pages`, { title: 'Notas' })
      const url = `/api/pages/${page.body.id}/attachments`
      let release!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      const slow = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode('hola '))
          await gate
          controller.enqueue(new TextEncoder().encode('mundo'))
          controller.close()
        },
      })
      const upload = client.request('POST', url, slow, { 'Content-Type': 'text/plain', 'Content-Length': '10', 'X-File-Name': 'a.txt' })
      await new Promise((resolve) => setTimeout(resolve, 50))
      let done = false
      const uninstall = client.post('/api/account/uninstall', { accessKey }).finally(() => (done = true))
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(done).toBe(false)
      expect((await client.upload(url, 'otro', { name: 'b.txt', type: 'text/plain' })).status).toBe(410)

      release()
      expect((await upload).status).toBe(201)
      expect((await uninstall).status).toBe(200)
      expect(readdirSync(path.join(other.env.dataDir, 'uploads'))).toEqual([])
      expect((other.db.get(sql.raw('select count(*) as n from attachments')) as { n: number }).n).toBe(0)
    } finally {
      await other.close()
    }
  })
})
