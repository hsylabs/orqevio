import { randomBytes } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { BackupDTO } from '@orqevio/shared'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { RawSql } from '../src/db/raw'
import { Client, type Harness, createHarness, seedBoard, signInOwner, signUp } from './harness'

const harnesses: Harness[] = []
const folders: string[] = []
async function copy(overrides: Parameters<typeof createHarness>[0] = {}) {
  const h = await createHarness(overrides)
  harnesses.push(h)
  return h
}
afterEach(() => vi.useRealTimers())
afterAll(async () => {
  for (const h of harnesses) await h.close()
  for (const dir of folders) await rm(dir, { recursive: true, force: true })
})

const keys = {
  kdf: { algorithm: 'argon2id', salt: 'c2FsdHNhbHRzYWx0c2FsdA', memoryKiB: 65536, iterations: 3, parallelism: 1 },
  wrappedKey: 'v1.aXZpdml2aXZpdml2.Y2lwaGVydGV4dA',
  recoveryWrappedKey: 'v1.aXZpdml2aXZpdml2.cmVjb3Zlcnk',
}

/**
 * Every row of every table, with its rowid, but the sessions and the access key (a restore changes
 * those on purpose) and the inner tables of full-text search: their rows are compared, and SQLite
 * lays out its index again as it puts them back.
 */
function everything(sql: RawSql) {
  const tables: Record<string, unknown[][]> = {}
  for (const [name] of sql.rows("SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 7) <> 'sqlite_' ORDER BY name")) {
    if (name === 'sessions' || name === 'instance' || /_fts_(?:data|idx|content|docsize|config)$/.test(String(name))) continue
    try {
      tables[String(name)] = [...sql.rows(`SELECT rowid, * FROM "${name}" ORDER BY rowid`)]
    } catch {
      // Tables without a rowid (some of those full-text search keeps).
      tables[String(name)] = [...sql.rows(`SELECT * FROM "${name}" ORDER BY 1`)]
    }
  }
  return tables
}

const fileBytes = async (h: Harness, client: Client, id: string) => {
  const res = await h.app.request(`/api/attachments/${id}`, { headers: { Cookie: client.cookie, Origin: 'http://localhost:3000' } })
  return new Uint8Array(await res.arrayBuffer())
}

describe('backups', () => {
  it('backs up the whole copy and puts it back exactly as it was, attachments, trash, history and vault included', async () => {
    const h = await copy()
    const { client, workspaceId, accessKey } = await signUp(h)
    const { projectId, boardId, columns } = await seedBoard(client, workspaceId)
    const label = (await client.post(`/api/boards/${boardId}/labels`, { name: 'Urgente', color: 'tomato' })).body.id as string
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Contratar la furgoneta', labelIds: [label] })).body.id as string
    await client.patch(`/api/cards/${card}`, { description: 'Comparar **tres** presupuestos.' })
    const list = (await client.post(`/api/cards/${card}/checklists`, { title: 'Pasos' })).body.id as string
    await client.post(`/api/checklists/${list}/items`, { text: 'Pedir precios' })
    const page = (await client.post(`/api/projects/${projectId}/pages`, { title: 'Inventario', content: '# Inventario\n\n- Platos\n- Vasos' })).body.id as string
    const pdf = randomBytes(300_000)
    const file = (await client.upload(`/api/cards/${card}/attachments`, pdf, { name: 'presupuesto.pdf', type: 'application/pdf' })).body.id as string
    const note = (await client.upload(`/api/pages/${page}/attachments`, 'Lista completa', { name: 'lista.txt', type: 'text/plain' })).body.id as string
    const gone = (await client.post(`/api/columns/${columns[1]!.id}/cards`, { title: 'Dar de baja la luz' })).body.id as string
    await client.del(`/api/cards/${gone}`)
    await client.post('/api/vault/setup', keys)
    await client.put('/api/vault/items/7d1d9b52-5f39-4c43-a43e-36d9c3f06a10', { data: 'v1.aXZpdml2aXZpdml2.c2VjcmV0', keyVersion: 1 })

    const before = everything(h.sql)
    const made = await client.post('/api/backups')
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({ kind: 'manual', files: 2, missingFiles: 0, newer: false, counts: { cards: 1, pages: 1, attachments: 2, vaultItems: 1, trash: 1 } })

    // Then a lot changes: texts, a deleted page with its file, a new file, another session, a new access key.
    await client.patch(`/api/cards/${card}`, { title: 'Otra cosa', description: 'Nada que ver' })
    await client.del(`/api/pages/${page}`)
    await client.upload(`/api/cards/${card}/attachments`, 'nuevo', { name: 'nuevo.txt', type: 'text/plain' })
    const other = await signInOwner(h)
    const newKey = (await client.post('/api/account/access-key', { currentAccessKey: accessKey })).body.accessKey as string
    expect(everything(h.sql)).not.toEqual(before)

    expect((await client.post(`/api/backups/${made.body.id}/restore`, { accessKey })).status).toBe(403)
    const restored = await client.post(`/api/backups/${made.body.id}/restore`, { accessKey: newKey })
    expect(restored.status, JSON.stringify(restored.body)).toBe(200)

    // Every table, row by row, rowids included (the history is ordered by them).
    expect(everything(h.sql)).toEqual(before)
    expect(Buffer.from(await fileBytes(h, client, file)).equals(pdf)).toBe(true)
    expect(new TextDecoder().decode(await fileBytes(h, client, note))).toBe('Lista completa')
    expect((await client.get(`/api/workspaces/${workspaceId}/search?q=furgoneta`)).body.map((r: { id: string }) => r.id)).toEqual([card])
    expect((await client.get(`/api/cards/${card}/history`)).body.map((e: { kind: string }) => e.kind)).toContain('card.description')
    expect((await client.get(`/api/workspaces/${workspaceId}/trash`)).body.map((t: { title: string }) => t.title)).toEqual(['Dar de baja la luz'])

    // The key in use now opens it; every other session ended, and the person who restored has a new one.
    expect((await client.get('/api/auth/me')).status).toBe(200)
    expect((await other.client.get('/api/auth/me')).status).toBe(401)
    expect((await new Client(h).post('/api/auth/login', { accessKey: newKey })).status).toBe(200)
    expect((await new Client(h).post('/api/auth/login', { accessKey })).status).toBe(401)

    // What was there before restoring is kept apart, in case.
    const backups = (await client.get('/api/backups')).body.backups as BackupDTO[]
    expect(backups.map((b) => b.kind)).toEqual(['before-restore', 'manual'])
  })

  it('makes one backup a day, keeps the 7 newest and only the attachments they list', async () => {
    const h = await copy()
    expect(await h.services.backups.runIfDue()).toBeNull()
    const { client, workspaceId } = await signUp(h)
    const { columns } = await seedBoard(client, workspaceId)
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Con archivos' })).body.id as string
    const kept = (await client.upload(`/api/cards/${card}/attachments`, 'se queda', { name: 'a.txt', type: 'text/plain' })).body
    const dropped = (await client.upload(`/api/cards/${card}/attachments`, 'se va', { name: 'b.txt', type: 'text/plain' })).body

    vi.useFakeTimers({ toFake: ['Date'] })
    const day = 24 * 60 * 60 * 1000
    const start = Date.parse('2026-11-01T03:00:00.000Z')
    vi.setSystemTime(start)
    expect(await h.services.backups.runIfDue()).not.toBeNull()
    vi.setSystemTime(start + 2 * 60 * 60 * 1000)
    expect(await h.services.backups.runIfDue()).toBeNull()

    // The second file leaves for good: older backups still keep it until they go.
    const trashId = (await client.del(`/api/attachments/${dropped.id}`)).body.trashId as string
    expect((await client.del(`/api/trash/${trashId}`)).status).toBe(204)
    const storedFiles = async () => (await h.backups!.list('files/')).length
    for (let i = 1; i <= 8; i++) {
      vi.setSystemTime(start + i * day)
      expect(await h.services.backups.runIfDue(), `day ${i}`).not.toBeNull()
      // Until the first backup goes (the 8th makes 8), the file it lists stays.
      expect(await storedFiles(), `day ${i}`).toBe(i < 7 ? 2 : 1)
    }
    const backups = (await client.get('/api/backups')).body.backups as BackupDTO[]
    expect(backups).toHaveLength(7)
    expect(backups.every((b) => b.kind === 'daily' && b.files === 1)).toBe(true)
    expect(backups[0]!.createdAt).toBe(new Date(start + 8 * day).toISOString())
    expect(backups.at(-1)!.createdAt).toBe(new Date(start + 2 * day).toISOString())
    expect((await h.backups!.list('snapshots/')).length).toBe(14)
    expect(kept.id).toBeTruthy()
  })

  it('makes no backup of an empty copy, nor of an uninstalled one, and uninstalling asks whether the backups go too', async () => {
    const keep = await copy()
    expect(await keep.services.backups.runIfDue()).toBeNull()
    const first = await signUp(keep)
    expect((await first.client.post('/api/backups')).status).toBe(201)
    expect((await first.client.post('/api/account/uninstall', { accessKey: first.accessKey })).status).toBe(400)
    const kept = await first.client.post('/api/account/uninstall', { accessKey: first.accessKey, deleteBackups: false })
    expect(kept.status).toBe(200)
    expect(kept.body.backups).toEqual({ kept: true, where: { kind: 'folder', name: keep.env.backupDir } })
    expect(await keep.services.backups.runIfDue(Date.now() + 2 * 24 * 60 * 60 * 1000)).toBeNull()
    expect((await keep.backups!.list('snapshots/')).length).toBe(2)

    const wipe = await copy()
    const second = await signUp(wipe)
    expect((await second.client.post('/api/backups')).status).toBe(201)
    const wiped = await second.client.post('/api/account/uninstall', { accessKey: second.accessKey, deleteBackups: true })
    expect(wiped.body.backups).toEqual({ kept: false, where: { kind: 'folder', name: wipe.env.backupDir } })
    expect(await wipe.backups!.list('')).toEqual([])
    // The page shown afterwards says so too.
    expect((await new Client(wipe).get('/api/auth/session')).body.uninstalled.backups.kept).toBe(false)
    expect((await new Client(keep).get('/api/auth/session')).body.uninstalled.backups.kept).toBe(true)
  })

  it('restores a backup made by an earlier version into a new copy, and brings it up to date', async () => {
    // An earlier version: the same migrations but the last one.
    const old = await mkdtemp(path.join(tmpdir(), 'orqevio-old-migrations-'))
    folders.push(old)
    const current = path.join(import.meta.dirname, '../drizzle')
    await cp(current, old, { recursive: true })
    const journal = JSON.parse(await readFile(path.join(current, 'meta/_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> }
    const last = journal.entries.pop()!
    await rm(path.join(old, `${last.tag}.sql`))
    await writeFile(path.join(old, 'meta/_journal.json'), JSON.stringify(journal))
    const shared = await mkdtemp(path.join(tmpdir(), 'orqevio-shared-backups-'))
    folders.push(shared)

    const earlier = await copy({ migrationsDir: old, backupDir: shared })
    const before = await signUp(earlier, 'Lucía Martín')
    const { columns } = await seedBoard(before.client, before.workspaceId)
    const card = (await before.client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'De la versión anterior' })).body.id as string
    expect((await before.client.post('/api/backups')).status).toBe(201)

    // A new copy with the same backups folder, claimed by its owner, finds the backup and restores it.
    const fresh = await copy({ backupDir: shared })
    const now = await signUp(fresh, 'Otra persona')
    const [backup] = (await now.client.get('/api/backups')).body.backups as BackupDTO[]
    expect(backup).toMatchObject({ kind: 'manual', newer: false })
    const restored = await now.client.post(`/api/backups/${backup!.id}/restore`, { accessKey: now.accessKey })
    expect(restored.status, JSON.stringify(restored.body)).toBe(200)
    expect((await now.client.get('/api/auth/me')).body.user.name).toBe('Lucía Martín')
    expect((await now.client.get(`/api/cards/${card}`)).body.title).toBe('De la versión anterior')
    // The migration the backup didn't have ran afterwards.
    expect([...fresh.sql.rows('SELECT name FROM pragma_table_info(?)', 'oauth_tokens')].flat()).toContain('scopes')
    expect([...fresh.sql.rows('SELECT count(*) FROM __drizzle_migrations')][0]![0]).toBe(journal.entries.length + 1)
  })

  it('refuses a backup made by a newer version, and a damaged one, without touching anything', async () => {
    const h = await copy()
    const { client, workspaceId, accessKey } = await signUp(h)
    await seedBoard(client, workspaceId)
    const made = (await client.post('/api/backups')).body as BackupDTO
    const before = everything(h.sql)
    const manifestKey = `snapshots/${made.id}/manifest.json`
    const manifest = JSON.parse(new TextDecoder().decode((await h.backups!.read(manifestKey))!))

    await h.backups!.write(manifestKey, new TextEncoder().encode(JSON.stringify({ ...manifest, migration: manifest.migration + 1 })))
    expect(((await client.get('/api/backups')).body.backups as BackupDTO[])[0]!.newer).toBe(true)
    const newer = await client.post(`/api/backups/${made.id}/restore`, { accessKey })
    expect(newer.status).toBe(409)
    expect(newer.body.error.code).toBe('backup_newer')

    await h.backups!.write(manifestKey, new TextEncoder().encode(JSON.stringify(manifest)))
    const data = (await h.backups!.read(`snapshots/${made.id}/data.ndjson.gz`))!
    data[data.length - 10] = data[data.length - 10]! ^ 0xff
    await h.backups!.write(`snapshots/${made.id}/data.ndjson.gz`, data)
    const damaged = await client.post(`/api/backups/${made.id}/restore`, { accessKey })
    expect(damaged.status).toBe(422)
    expect(damaged.body.error.code).toBe('backup_damaged')

    expect(everything(h.sql)).toEqual(before)
    expect((await client.get('/api/auth/me')).status).toBe(200)
    expect((await client.post('/api/backups/../../etc/restore', { accessKey })).status).toBe(404)
  })

  it('restores the backup made before a restore, attachments only it kept included', async () => {
    const h = await copy()
    const { client, workspaceId, accessKey } = await signUp(h)
    const { columns } = await seedBoard(client, workspaceId)
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Con archivos' })).body.id as string
    const first = (await client.post('/api/backups')).body as BackupDTO
    const later = (await client.upload(`/api/cards/${card}/attachments`, 'subido después', { name: 'despues.txt', type: 'text/plain' })).body as { id: string }

    // Back to the first backup: the file uploaded later is only in the backup made before restoring.
    expect((await client.post(`/api/backups/${first.id}/restore`, { accessKey })).status).toBe(200)
    const before = ((await client.get('/api/backups')).body.backups as BackupDTO[]).find((b) => b.kind === 'before-restore')!
    // Unused now, its file goes from the uploads (as the hourly sweep would do).
    await rm(path.join(h.env.dataDir, 'uploads', workspaceId), { recursive: true, force: true })

    // Undoing that restore makes a new backup first: the one being restored and its file must survive it.
    const undone = await client.post(`/api/backups/${before.id}/restore`, { accessKey })
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    expect(new TextDecoder().decode(await fileBytes(h, client, later.id))).toBe('subido después')
    // Afterwards only the newest backup made before a restore is kept.
    const kinds = ((await client.get('/api/backups')).body.backups as BackupDTO[]).map((b) => b.kind)
    expect(kinds).toEqual(['before-restore', 'manual'])
  })

  it('waits for a backup still being written before deleting the backups on uninstall', async () => {
    const h = await copy()
    const { client, accessKey } = await signUp(h)
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const write = h.backups!.write.bind(h.backups!)
    // The backup stops while writing its data, as a slow disk or bucket would.
    h.backups!.write = async (key, data) => {
      if (key.endsWith('data.ndjson.gz')) await held
      return write(key, data)
    }
    const backup = client.post('/api/backups')
    await new Promise((resolve) => setTimeout(resolve, 50))
    let done = false
    const uninstall = client.post('/api/account/uninstall', { accessKey, deleteBackups: true }).finally(() => (done = true))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(done).toBe(false)
    release()
    expect((await backup).status).toBe(201)
    expect((await uninstall).status).toBe(200)
    expect(await h.backups!.list('')).toEqual([])
    // And none starts afterwards.
    expect(await h.services.backups.runIfDue(Date.now() + 2 * 24 * 60 * 60 * 1000)).toBeNull()
  })

  it('keeps the backups as private as the attachments: only the server’s user reads them', async () => {
    const h = await copy()
    const { client, workspaceId } = await signUp(h)
    const { columns } = await seedBoard(client, workspaceId)
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Privada' })).body.id as string
    await client.upload(`/api/cards/${card}/attachments`, 'secreto', { name: 'secreto.txt', type: 'text/plain' })
    const made = (await client.post('/api/backups')).body as BackupDTO
    const root = h.env.backupDir!
    const mode = async (file: string) => (await stat(path.join(root, file))).mode & 0o777
    const [stored] = await h.backups!.list('files/')
    expect(await mode(stored!.key)).toBe(0o600)
    expect(await mode(`snapshots/${made.id}/data.ndjson.gz`)).toBe(0o600)
    expect(await mode(`snapshots/${made.id}/manifest.json`)).toBe(0o600)
    expect(await mode(`snapshots/${made.id}`)).toBe(0o700)
    expect(await mode(path.dirname(stored!.key))).toBe(0o700)
  })

  it('is for the owner only, never for agents', async () => {
    const h = await copy()
    const { client, workspaceId } = await signUp(h)
    const token = (await client.post('/api/tokens', { name: 'Claude', workspaceId, scopes: ['tasks:read', 'tasks:write', 'docs:read', 'docs:write', 'organize'], expiresInDays: 30 })).body.token as string
    const agent = new Client(h, token)
    expect((await agent.get('/api/backups')).status).toBe(403)
    expect((await agent.post('/api/backups')).status).toBe(403)
    // Nor anyone but the owner, should a copy have someone else.
    const member = await signUp(h, 'Otra persona')
    expect((await member.client.get('/api/backups')).status).toBe(403)
    expect((await member.client.post('/api/backups')).status).toBe(403)
  })

  it('says when this copy makes no backups', async () => {
    const h = await copy({ backupDir: null })
    const { client } = await signUp(h)
    expect((await client.get('/api/backups')).body).toEqual({ where: null, keep: 7, backups: [] })
    expect((await client.post('/api/backups')).status).toBe(409)
  })
})

describe('backups and their attachments', () => {
  /** Where a backup keeps an attachment, in the folder. */
  const keptFile = (h: Harness, storageKey: string) => path.join(h.env.backupDir!, 'files', ...storageKey.split('/'))
  const manifestOf = async (h: Harness, id: string) => JSON.parse(new TextDecoder().decode((await h.backups!.read(`snapshots/${id}/manifest.json`))!))

  it('checks every attachment a restore needs before anything changes, names what is damaged, and goes without it only when asked', async () => {
    const h = await copy()
    const { client, workspaceId, accessKey } = await signUp(h)
    const { columns } = await seedBoard(client, workspaceId)
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Con archivos' })).body.id as string
    const pdf = randomBytes(40_000)
    const files = {
      pdf: (await client.upload(`/api/cards/${card}/attachments`, pdf, { name: 'presupuesto.pdf', type: 'application/pdf' })).body.id as string,
      image: (await client.upload(`/api/cards/${card}/attachments`, randomBytes(2_000), { name: 'plano.png', type: 'image/png' })).body.id as string,
      note: (await client.upload(`/api/cards/${card}/attachments`, 'Lista', { name: 'lista.txt', type: 'text/plain' })).body.id as string,
      fine: (await client.upload(`/api/cards/${card}/attachments`, 'Intacto', { name: 'intacto.txt', type: 'text/plain' })).body.id as string,
    }
    const made = (await client.post('/api/backups')).body as BackupDTO
    const manifest = await manifestOf(h, made.id)
    // Each kept with what it was: its name and its SHA-256.
    expect(manifest.files).toHaveLength(4)
    for (const f of manifest.files) expect(f).toMatchObject({ sha256: expect.stringMatching(/^[0-9a-f]{64}$/), name: expect.any(String) })
    const key = (name: string) => manifest.files.find((f: { name: string }) => f.name === name).key as string

    // A new server: the copy's own files are gone. And in the backup, one is cut short, one changed, one gone.
    await rm(path.join(h.env.dataDir, 'uploads', workspaceId), { recursive: true, force: true })
    const cut = await readFile(keptFile(h, key('presupuesto.pdf')))
    await writeFile(keptFile(h, key('presupuesto.pdf')), cut.subarray(0, 1000))
    const image = await readFile(keptFile(h, key('plano.png')))
    image[10] = image[10]! ^ 0xff
    await writeFile(keptFile(h, key('plano.png')), image)
    await rm(keptFile(h, key('lista.txt')))
    const before = everything(h.sql)

    const refused = await client.post(`/api/backups/${made.id}/restore`, { accessKey })
    expect(refused.status).toBe(422)
    expect(refused.body.error.code).toBe('backup_files_damaged')
    expect(refused.body.error.details.files).toEqual(
      expect.arrayContaining([
        { name: 'presupuesto.pdf', reason: 'size' },
        { name: 'plano.png', reason: 'changed' },
        { name: 'lista.txt', reason: 'missing' },
      ]),
    )
    expect(refused.body.error.details.files).toHaveLength(3)
    // Nothing changed: not the data, and no backup was made before a restore that didn't happen.
    expect(everything(h.sql)).toEqual(before)
    expect(((await client.get('/api/backups')).body.backups as BackupDTO[]).map((b) => b.kind)).toEqual(['manual'])

    // Asked to, it restores without them, and says which were left out.
    const done = await client.post(`/api/backups/${made.id}/restore`, { accessKey, withoutDamaged: true })
    expect(done.status, JSON.stringify(done.body)).toBe(200)
    expect(done.body.leftOut).toHaveLength(3)
    expect(new TextDecoder().decode(await fileBytes(h, client, files.fine))).toBe('Intacto')
    // A damaged copy is never put back: what was cut short or changed is not served as if whole.
    for (const id of [files.pdf, files.image, files.note]) {
      expect((await h.app.request(`/api/attachments/${id}`, { headers: { Cookie: client.cookie, Origin: 'http://localhost:3000' } })).status).toBe(404)
    }
  })

  it('copies again a kept attachment that is cut short, or that an earlier backup kept without saying what it was', async () => {
    const h = await copy()
    const { client, workspaceId } = await signUp(h)
    const { columns } = await seedBoard(client, workspaceId)
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Con archivo' })).body.id as string
    const bytes = randomBytes(20_000)
    await client.upload(`/api/cards/${card}/attachments`, bytes, { name: 'datos.bin', type: 'application/octet-stream' })
    const first = (await client.post('/api/backups')).body as BackupDTO
    const [kept] = (await manifestOf(h, first.id)).files
    await writeFile(keptFile(h, kept.key), bytes.subarray(0, 500))

    vi.useFakeTimers({ now: Date.now() + 60_000, toFake: ['Date'] })
    const second = (await client.post('/api/backups')).body as BackupDTO
    expect((await readFile(keptFile(h, kept.key))).equals(bytes)).toBe(true)
    expect((await manifestOf(h, second.id)).files[0]).toMatchObject({ key: kept.key, size: 20_000, sha256: kept.sha256 })

    // A backup of 1.2: files without their SHA-256. The next one copies them again, and says it.
    const legacy = await manifestOf(h, second.id)
    await h.backups!.write(`snapshots/${second.id}/manifest.json`, new TextEncoder().encode(JSON.stringify({ ...legacy, files: legacy.files.map(({ key, size }: { key: string; size: number }) => ({ key, size })) })))
    await rm(path.join(h.env.backupDir!, 'snapshots', first.id), { recursive: true, force: true })
    vi.setSystemTime(Date.now() + 120_000)
    const third = (await client.post('/api/backups')).body as BackupDTO
    expect((await manifestOf(h, third.id)).files[0]).toMatchObject({ key: kept.key, sha256: kept.sha256, name: 'datos.bin' })
  })

  it('says why backups cannot be made where they go, in Settings and when backing up now', async () => {
    // Where the backups go is a file, not a folder.
    const dir = await mkdtemp(path.join(tmpdir(), 'orqevio-not-a-folder-'))
    folders.push(dir)
    const file = path.join(dir, 'backups')
    await writeFile(file, 'not a folder')
    const h = await copy({ backupDir: file })
    const { client } = await signUp(h)
    const status = (await client.get('/api/backups')).body
    expect(status.problem).toMatchObject({ code: 'other', path: file })
    const now = await client.post('/api/backups')
    expect([now.status, now.body.error.code]).toEqual([409, 'backup_folder'])
    expect(now.body.error.message).toContain(file)
  })

  it('tells a folder that is not the app’s, read-only or full, and what to do', async () => {
    const { problemOf, describeBackupProblem } = await import('../src/backups/store')
    const error = (code: string) => Object.assign(new Error(`${code}: failed`), { code })
    const user = `${process.getuid?.()}:${process.getgid?.()}`
    expect(problemOf(error('EACCES'), '/data/backups')).toEqual({ code: 'access', path: '/data/backups', user, detail: 'EACCES: failed' })
    expect(problemOf(error('EROFS'), '/b').code).toBe('readonly')
    expect(problemOf(error('ENOSPC'), '/b').code).toBe('full')
    const told = describeBackupProblem(problemOf(error('EACCES'), '/data/backups/files'), '/data/backups')
    expect(told).toContain(`sudo chown -R ${user}`)
    expect(told).toContain('chown -R orqevio:orqevio /data/backups.')
  })
})
