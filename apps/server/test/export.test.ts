import { randomBytes } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { safeName } from '../src/services/export'
import { Client, type Harness, ORIGIN, createHarness, seedBoard, signUp } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => h.close())

async function download(client: Client) {
  const res = await h.app.request('/api/export', { headers: { Cookie: client.cookie, Origin: ORIGIN } })
  return { res, files: res.ok ? unzipSync(new Uint8Array(await res.arrayBuffer())) : {} }
}

describe('export', () => {
  it('gives the person’s data as a ZIP to read: tasks in JSON, documents in Markdown, attachments as files', async () => {
    const { client, workspaceId } = await signUp(h, 'Lucía Martín')
    await client.patch(`/api/workspaces/${workspaceId}`, { name: 'Casa' })
    const { projectId, boardId, columns } = await seedBoard(client, workspaceId)
    const label = (await client.post(`/api/boards/${boardId}/labels`, { name: 'Urgente', color: 'tomato' })).body.id as string
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Contratar la furgoneta', labelIds: [label], dueAt: '2026-12-01T12:00:00.000Z' })).body.id as string
    await client.patch(`/api/cards/${card}`, { description: 'Comparar **tres** presupuestos.' })
    const list = (await client.post(`/api/cards/${card}/checklists`, { title: 'Pasos' })).body.id as string
    const step = (await client.post(`/api/checklists/${list}/items`, { text: 'Pedir precios' })).body.id as string
    await client.patch(`/api/checklist-items/${step}`, { done: true })
    const archived = (await client.post(`/api/columns/${columns[1]!.id}/cards`, { title: 'Idea descartada' })).body.id as string
    await client.post(`/api/cards/${archived}/archive`)
    const inventory = (await client.post(`/api/projects/${projectId}/pages`, { title: 'Inventario', content: '# Inventario\n\n- Platos' })).body.id as string
    await client.post(`/api/projects/${projectId}/pages`, { title: 'Cocina', parentId: inventory, content: 'Sartenes' })
    // Same title twice, and characters no file system takes.
    await client.post(`/api/projects/${projectId}/pages`, { title: 'Inventario', content: 'Otro' })
    await client.post(`/api/projects/${projectId}/pages`, { title: 'Facturas 2026/11: «luz»?', content: 'Luz' })
    await client.post(`/api/cards/${card}/pages`, { pageId: inventory })
    const pdf = randomBytes(200_000)
    await client.upload(`/api/cards/${card}/attachments`, pdf, { name: 'presupuesto.pdf', type: 'application/pdf' })
    await client.upload(`/api/pages/${inventory}/attachments`, 'Lista completa', { name: 'lista.txt', type: 'text/plain' })
    // Not exported: the trash, the history and the vault.
    const gone = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Borrada' })).body.id as string
    await client.del(`/api/cards/${gone}`)
    // Someone else's workspace is theirs alone.
    const other = await signUp(h, 'Otra persona')
    await seedBoard(other.client, other.workspaceId)

    const { res, files } = await download(client)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="orqevio-\d{4}-\d{2}-\d{2}\.zip"$/)
    const names = Object.keys(files)
    const root = names[0]!.split('/')[0]!
    const at = (path: string) => files[`${root}/${path}`]
    expect(JSON.parse(strFromU8(at('export.json')!))).toMatchObject({ format: 'orqevio-export', version: 1, workspaces: [{ name: 'Casa', folder: 'Casa' }] })
    expect(names.filter((n) => n.includes('/Espacio de Otra') || n.includes('Otra persona'))).toEqual([])

    // Documents, with their tree as folders and names every system takes.
    expect(strFromU8(at('Casa/documents/Lanzamiento/Inventario.md')!)).toBe('# Inventario\n\n- Platos')
    expect(strFromU8(at('Casa/documents/Lanzamiento/Inventario/Cocina.md')!)).toBe('Sartenes')
    expect(strFromU8(at('Casa/documents/Lanzamiento/Inventario (2).md')!)).toBe('Otro')
    expect(strFromU8(at('Casa/documents/Lanzamiento/Facturas 2026-11- «luz»-.md')!)).toBe('Luz')
    // Attachments, byte for byte: a page's next to it, a card's under attachments/.
    expect(strFromU8(at('Casa/documents/Lanzamiento/Inventario (files)/lista.txt')!)).toBe('Lista completa')
    expect(Buffer.from(at('Casa/attachments/Contratar la furgoneta/presupuesto.pdf')!).equals(pdf)).toBe(true)

    // Tasks, in JSON.
    const tasks = JSON.parse(strFromU8(at('Casa/tasks.json')!))
    const board = tasks.projects[0].boards[0]
    expect(board).toMatchObject({ name: 'Producto', labels: [{ name: 'Urgente', color: 'tomato' }] })
    expect(board.columns[0].cards[0]).toMatchObject({
      title: 'Contratar la furgoneta',
      description: 'Comparar **tres** presupuestos.',
      labels: ['Urgente'],
      due: '2026-12-01',
      archived: false,
      checklists: [{ title: 'Pasos', items: [{ text: 'Pedir precios', done: true }] }],
      documents: ['documents/Lanzamiento/Inventario.md'],
      attachments: ['attachments/Contratar la furgoneta/presupuesto.pdf'],
    })
    expect(board.columns[1].cards.map((c: { title: string; archived: boolean }) => [c.title, c.archived])).toEqual([['Idea descartada', true]])
    const everything = names.map((n) => strFromU8(files[n]!)).join('\n')
    expect(everything).not.toContain('Borrada')
    expect(names.some((n) => /vault|history|trash/i.test(n))).toBe(false)
  })

  it('keeps every entry apart, links documents to their attachments, walks any depth and lists missing files', async () => {
    const { client, workspaceId } = await signUp(h, 'Árboles')
    await client.patch(`/api/workspaces/${workspaceId}`, { name: 'Árboles' })
    const { projectId, columns } = await seedBoard(client, workspaceId)
    // A page "A" with an attachment named like a subpage of its sibling "A (files)".
    const a = (await client.post(`/api/projects/${projectId}/pages`, { title: 'A' })).body.id as string
    const sibling = (await client.post(`/api/projects/${projectId}/pages`, { title: 'A (files)' })).body.id as string
    await client.post(`/api/projects/${projectId}/pages`, { title: 'Child', parentId: sibling, content: 'subpágina' })
    const image = (await client.upload(`/api/pages/${a}/attachments`, 'adjunto', { name: 'Child.md', type: 'text/markdown' })).body as { id: string }
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Con plano' })).body.id as string
    const plan = (await client.upload(`/api/cards/${card}/attachments`, 'plano', { name: 'plano (v2).png', type: 'image/png' })).body as { id: string }
    const version = (await client.get(`/api/pages/${a}`)).body.version as number
    const saved = await client.patch(`/api/pages/${a}`, { content: `![](/api/attachments/${image.id})\n\n[plano](http://localhost:3000/api/attachments/${plan.id})`, baseVersion: version })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    await client.patch(`/api/cards/${card}`, { description: `Ver ![](/api/attachments/${plan.id})` })
    // A chain deeper than any limit a recursive walk would have.
    const deep = (await client.post(`/api/workspaces/${workspaceId}/projects`, { name: 'Hondo', color: 'jade' })).body.id as string
    let parent: string | null = null
    for (let i = 0; i < 230; i++) parent = (await client.post(`/api/projects/${deep}/pages`, { title: `N${i}`, parentId: parent })).body.id as string
    // A file gone from storage: listed, never an empty file.
    const lost = (await client.upload(`/api/cards/${card}/attachments`, 'perdido', { name: 'perdido.txt', type: 'text/plain' })).body as { storageKey?: string; id: string }
    const [row] = [...h.sql.rows('SELECT storage_key FROM attachments WHERE id = ?', lost.id)]
    await rm(path.join(h.env.dataDir, 'uploads', String(row![0])))

    const { files } = await download(client)
    const names = Object.keys(files)
    const root = names[0]!.split('/')[0]!
    const at = (p: string) => files[`${root}/Árboles/${p}`]
    expect(new Set(names).size).toBe(names.length)
    // A's attachments take "A (files)" first: the sibling page becomes "A (files) (2)".
    expect(strFromU8(at('documents/Lanzamiento/A (files)/Child.md')!)).toBe('adjunto')
    expect(strFromU8(at('documents/Lanzamiento/A (files) (2)/Child.md')!)).toBe('subpágina')
    expect(at('documents/Lanzamiento/A (files) (2).md')).toBeDefined()
    // Links point at the files in the ZIP, relative to the document, encoded.
    expect(strFromU8(at('documents/Lanzamiento/A.md')!)).toBe('![](A%20%28files%29/Child.md)\n\n[plano](../../attachments/Con%20plano/plano%20%28v2%29.png)')
    expect(at('attachments/Con plano/plano (v2).png')).toBeDefined()
    const tasks = JSON.parse(strFromU8(at('tasks.json')!))
    expect(tasks.projects[0].boards[0].columns[0].cards[0].description).toBe('Ver ![](attachments/Con%20plano/plano%20%28v2%29.png)')
    expect(names.filter((n) => n.includes('/documents/Hondo/'))).toHaveLength(230)
    expect(names.some((n) => n.endsWith('perdido.txt'))).toBe(false)
    expect(JSON.parse(strFromU8(files[`${root}/export.json`]!)).missingAttachments).toEqual(['Árboles/attachments/Con plano/perdido.txt'])
  })

  it('is for people, not for agents', async () => {
    const { client, workspaceId } = await signUp(h, 'Con agente')
    const token = (await client.post('/api/tokens', { name: 'Claude', workspaceId, scopes: ['tasks:read', 'docs:read'], expiresInDays: 30 })).body.token as string
    expect((await new Client(h, token).get('/api/export')).status).toBe(403)
    expect((await new Client(h).get('/api/export')).status).toBe(401)
  })

  it('names files so that every system takes them', () => {
    expect(safeName('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j')
    expect(safeName('   ')).toBe('Untitled')
    expect(safeName('..oculto. ')).toBe('oculto')
    expect(safeName('x'.repeat(200))).toHaveLength(150)
    // Cut by bytes: an emoji takes 4, and the name must stay under the 255 bytes file systems take.
    const emoji = safeName('🍳'.repeat(80))
    expect(new TextEncoder().encode(emoji).length).toBeLessThanOrEqual(150)
    expect(emoji).toBe('🍳'.repeat(37))
    expect(safeName('línea\nnueva\ttab')).toBe('línea-nueva-tab')
  })
})
