import { randomBytes } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { attachments, pages } from '../src/db/schema'
import { type Harness, createHarness, seedBoard, signUp } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => h.close())

describe('documents', () => {
  it('creates nested pages, guards concurrent edits and syncs card mentions', async () => {
    const { client, workspaceId } = await signUp(h)
    const { projectId, columns } = await seedBoard(client, workspaceId)
    const card = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Diseñar landing' })

    const root = await client.post(`/api/projects/${projectId}/pages`, { title: 'Especificación' })
    const child = await client.post(`/api/projects/${projectId}/pages`, { title: 'Detalle', parentId: root.body.id })
    expect(child.status).toBe(201)

    const content = `Ver [Diseñar landing](/card/${card.body.id}) para el estado.`
    const saved = await client.patch(`/api/pages/${root.body.id}`, { content, baseVersion: 1 })
    expect(saved.body.version).toBe(2)

    const stale = await client.patch(`/api/pages/${root.body.id}`, { content: 'old', baseVersion: 1 })
    expect(stale.status).toBe(409)
    expect(stale.body.error.details.currentVersion).toBe(2)
    expect((await client.patch(`/api/pages/${root.body.id}`, { content: 'no version' })).status).toBe(400)
    // Renaming does not bump the content version, so it never conflicts with an open editor.
    const renamed = await client.patch(`/api/pages/${root.body.id}`, { title: 'Especificación' })
    expect(renamed.body.version).toBe(2)

    const page = await client.get(`/api/pages/${root.body.id}`)
    expect(page.body.cards).toEqual([expect.objectContaining({ id: card.body.id, sources: ['mention'] })])
    expect(page.body.children.map((c: { title: string }) => c.title)).toEqual(['Detalle'])
    const childPage = await client.get(`/api/pages/${child.body.id}`)
    expect(childPage.body.breadcrumbs.map((b: { title: string }) => b.title)).toEqual(['Especificación'])

    const cardDetail = await client.get(`/api/cards/${card.body.id}`)
    expect(cardDetail.body.pages).toEqual([expect.objectContaining({ id: root.body.id, sources: ['mention'] })])

    // Manual link on top of the mention; removing the mention keeps the manual one.
    await client.post(`/api/cards/${card.body.id}/pages`, { pageId: root.body.id })
    await client.patch(`/api/pages/${root.body.id}`, { content: 'Sin enlaces', baseVersion: 2 })
    const after = await client.get(`/api/cards/${card.body.id}`)
    expect(after.body.pages[0].sources).toEqual(['manual'])
  })

  it('prevents moving a page inside its own subtree', async () => {
    const { client, workspaceId } = await signUp(h)
    const { projectId } = await seedBoard(client, workspaceId)
    const a = await client.post(`/api/projects/${projectId}/pages`, { title: 'A' })
    const b = await client.post(`/api/projects/${projectId}/pages`, { title: 'B', parentId: a.body.id })
    expect((await client.post(`/api/pages/${a.body.id}/move`, { parentId: b.body.id, index: 0 })).status).toBe(400)
    expect((await client.post(`/api/pages/${b.body.id}/move`, { parentId: null, index: 0 })).status).toBe(204)
    const tree = await client.get(`/api/projects/${projectId}/pages`)
    expect(tree.body.map((p: { title: string }) => p.title)).toEqual(['B', 'A'])
  })

  it('searches cards and pages with excerpts', async () => {
    const { client, workspaceId } = await signUp(h)
    const { projectId, columns } = await seedBoard(client, workspaceId)
    await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Migrar facturación' })
    await client.post(`/api/projects/${projectId}/pages`, { title: 'Notas', content: 'El proceso de facturación mensual empieza el día 1.' })
    const res = await client.get(`/api/workspaces/${workspaceId}/search?q=factura`)
    expect(res.body.map((r: { type: string }) => r.type).sort()).toEqual(['card', 'page'])
    const page = res.body.find((r: { type: string }) => r.type === 'page')
    expect(page.excerpt).toContain('facturación mensual')
    expect((await client.get(`/api/workspaces/${workspaceId}/search?q=%25`)).body).toEqual([])
  })

  it('full-text search ignores accents and case, ranks titles first and respects boundaries', async () => {
    const { client, workspaceId } = await signUp(h)
    const { projectId, columns } = await seedBoard(client, workspaceId)
    const search = async (q: string) =>
      (await client.get(`/api/workspaces/${workspaceId}/search?q=${encodeURIComponent(q)}`)).body as Array<{ id: string; type: string; title: string }>
    await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Revisar la canción del anuncio' })
    await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Otra tarea', description: 'Mencionar la CANCION en la reunión' })
    const archived = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Canción archivada' })
    await client.post(`/api/cards/${archived.body.id}/archive`)
    await client.post(`/api/projects/${projectId}/pages`, { title: 'Guion', content: 'Letra de la cancion principal.' })

    // Accents and case do not matter, and the card with the word in its title comes first.
    const cards = (await search('Cancion')).filter((r) => r.type === 'card').map((r) => r.title)
    expect(cards).toEqual(['Revisar la canción del anuncio', 'Otra tarea'])
    expect((await search('canci')).map((r) => r.type).sort()).toEqual(['card', 'card', 'page'])
    // Every word has to match.
    expect((await search('cancion reunion')).map((r) => r.title)).toEqual(['Otra tarea'])
    // Quotes and FTS operators are plain text: "OR" is just another word that must match.
    expect(await search('"canción"')).toHaveLength(3)
    expect(await search('canción OR')).toEqual([])
    expect(await search('* - "')).toEqual([])
    expect((await client.get(`/api/workspaces/${workspaceId}/search?q=${encodeURIComponent('C++ (x) NEAR/2')}`)).status).toBe(200)
    // Updates and deletions keep the index in sync.
    const page = (await search('principal'))[0]!
    const { body } = await client.get(`/api/pages/${page.id}`)
    await client.patch(`/api/pages/${page.id}`, { content: 'Texto nuevo', baseVersion: body.version })
    expect(await search('principal')).toEqual([])
    expect((await search('nuevo')).map((r) => r.title)).toEqual(['Guion'])
    await client.del(`/api/pages/${page.id}`)
    expect(await search('nuevo')).toEqual([])
    // Other workspaces are never searched.
    const other = await signUp(h, 'Otra persona')
    expect((await other.client.get(`/api/workspaces/${other.workspaceId}/search?q=cancion`)).body).toEqual([])
  })

  it('ranks title matches first even when their bodies are long', async () => {
    const { client, workspaceId } = await signUp(h, 'Ranking')
    const { columns } = await seedBoard(client, workspaceId)
    for (let i = 0; i < 20; i++) await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: `Relleno ${i}`, description: 'nada que ver' })
    await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Otra tarea', description: 'cancion' })
    await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Canción', description: 'palabra '.repeat(1000) })
    const res = await client.get(`/api/workspaces/${workspaceId}/search?q=cancion&type=card`)
    expect(res.body.map((r: { title: string }) => r.title)).toEqual(['Canción', 'Otra tarea'])
  })

  it('keeps saving and cascading deletes fast with thousands of indexed pages', async () => {
    const { client, workspaceId } = await signUp(h, 'Volumen')
    const { projectId } = await seedBoard(client, workspaceId)
    h.db.transaction((tx) => {
      for (let i = 0; i < 8000; i++) {
        tx.insert(pages)
          .values({ workspaceId, projectId, title: `Nota ${i}`, content: `contenido ${i}`, position: `a${String(i).padStart(5, '0')}` })
          .run()
      }
    })
    expect((await client.get(`/api/workspaces/${workspaceId}/search?q=${encodeURIComponent('nota 7999')}&type=page`)).body).toHaveLength(1)
    const started = Date.now()
    expect((await client.del(`/api/projects/${projectId}`)).status).toBe(204)
    // A full scan of the index per deleted page would take several seconds here.
    expect(Date.now() - started).toBeLessThan(1000)
    expect((await client.get(`/api/workspaces/${workspaceId}/search?q=nota&type=page`)).body).toEqual([])
  })

  it('stores attachments, sniffs their type and protects access', async () => {
    const { client, workspaceId } = await signUp(h)
    const { projectId } = await seedBoard(client, workspaceId)
    const page = await client.post(`/api/projects/${projectId}/pages`, { title: 'Con imagen' })
    const url = `/api/pages/${page.body.id}/attachments`
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    const up = await client.upload(url, png, { name: 'píxel ñ.png', type: 'text/html' })
    expect(up.status).toBe(201)
    expect(up.body).toMatchObject({ mimeType: 'image/png', isImage: true, filename: 'píxel ñ.png', size: png.byteLength })

    const svgUp = await client.upload(url, '<svg onload="alert(1)"/>', { name: 'x.svg', type: 'image/svg+xml' })
    const download = await h.app.request(svgUp.body.url, { headers: { Cookie: client.cookie } })
    expect(download.headers.get('content-type')).toBe('application/octet-stream')
    expect(download.headers.get('content-disposition')).toMatch(/^attachment/)

    const stranger = await signUp(h)
    expect((await stranger.client.get(up.body.url)).status).toBe(404)
  })

  it('streams uploads to storage and rejects bad ones without leaving files behind', async () => {
    const { client, workspaceId } = await signUp(h)
    const { projectId } = await seedBoard(client, workspaceId)
    const page = await client.post(`/api/projects/${projectId}/pages`, { title: 'Adjuntos' })
    const url = `/api/pages/${page.body.id}/attachments`
    const uploads = path.join(h.env.dataDir, 'uploads', workspaceId)
    const stored = async () => (await readdir(uploads).catch(() => [] as string[])).length

    // A few MB arrive intact, byte for byte.
    const big = randomBytes(3 * 1024 * 1024 + 7)
    const up = await client.upload(url, big, { name: 'datos.bin' })
    expect(up.status).toBe(201)
    const back = new Uint8Array(await (await h.app.request(up.body.url, { headers: { Cookie: client.cookie } })).arrayBuffer())
    expect(Buffer.compare(back, big)).toBe(0)
    expect(await stored()).toBe(1)

    const tooLarge = await client.upload(url, 'x', { length: h.env.maxUploadBytes + 1 })
    expect(tooLarge.status).toBe(413)
    expect(tooLarge.body.error.code).toBe('file_too_large')

    const form = new FormData()
    form.append('file', new File(['hola'], 'hola.txt'))
    const multipart = await client.request('POST', url, form)
    expect(multipart.status).toBe(415)
    expect(multipart.body.error.code).toBe('raw_upload_required')

    const noLength = await client.request('POST', url, new Uint8Array([1, 2, 3]), { 'Content-Type': 'text/plain' })
    expect(noLength.status).toBe(411)

    expect((await client.upload(url, '', { name: 'vacío.txt' })).status).toBe(400)

    // The body ends before its declared length: nothing is kept.
    const short = await client.request('POST', url, new ReadableStream({ start: (c) => (c.enqueue(new Uint8Array(10)), c.close()) }), {
      'Content-Type': 'application/octet-stream',
      'Content-Length': '100',
    })
    expect(short.status).toBe(400)
    expect(short.body.error.code).toBe('upload_incomplete')
    // More bytes than announced are refused too.
    const long = await client.request('POST', url, new ReadableStream({ start: (c) => (c.enqueue(new Uint8Array(200)), c.close()) }), {
      'Content-Type': 'application/octet-stream',
      'Content-Length': '100',
    })
    expect(long.status).toBe(400)
    expect(await stored()).toBe(1)
    expect(await h.db.select().from(attachments).where(eq(attachments.pageId, page.body.id))).toHaveLength(1)
  })
})
