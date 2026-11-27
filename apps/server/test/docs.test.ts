import { randomBytes } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { inList } from '../src/db/in-list'
import { attachments, pages } from '../src/db/schema'
import { type Harness, createHarness, createPageChain, seedBoard, signUp } from './harness'

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

  it('names every page above a deep one, the top first', async () => {
    const { client, workspaceId } = await signUp(h)
    const { projectId } = await seedBoard(client, workspaceId)
    let parentId: string | null = null
    for (let i = 1; i <= 40; i++) parentId = (await client.post(`/api/projects/${projectId}/pages`, { title: `Nivel ${i}`, parentId })).body.id
    const deepest = await client.get(`/api/pages/${parentId}`)
    expect(deepest.body.title).toBe('Nivel 40')
    // It used to stop at 32: the 7 at the top were missing.
    expect(deepest.body.breadcrumbs.map((b: { title: string }) => b.title)).toEqual(Array.from({ length: 39 }, (_, i) => `Nivel ${i + 1}`))
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

  it('finds words inside a run of text, in languages written without spaces and in compounds', async () => {
    const { client, workspaceId } = await signUp(h, 'Idiomas')
    const { projectId, columns } = await seedBoard(client, workspaceId)
    const search = async (q: string) =>
      ((await client.get(`/api/workspaces/${workspaceId}/search?q=${encodeURIComponent(q)}`)).body as Array<{ title: string; comment?: unknown }>).map((r) => r.title)
    await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: '会議の議事録を作成する' })
    await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: '编写会议记录' })
    await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'สร้างบันทึกการประชุม' })
    await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: '회의 기록을 작성하다' })
    await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Viaje a İstanbul' })
    await client.post(`/api/projects/${projectId}/pages`, { title: 'Projektplan', content: 'Termine und Aufgaben' })
    await client.post(`/api/projects/${projectId}/pages`, { title: 'Canción', content: '本日の議題について' })

    // In Japanese, Chinese and Thai, a word in the middle of the text: three characters or more
    // through trigrams, fewer read as they are. In 1.5.0 only the start of the run was found.
    expect(await search('議事録')).toEqual(['会議の議事録を作成する'])
    expect(await search('会議')).toEqual(['会議の議事録を作成する'])
    expect(await search('作成')).toEqual(['会議の議事録を作成する'])
    expect(await search('会议')).toEqual(['编写会议记录'])
    expect(await search('记录')).toEqual(['编写会议记录'])
    expect(await search('บันทึก')).toEqual(['สร้างบันทึกการประชุม'])
    expect(await search('議題')).toEqual(['Canción'])
    // Korean separates its words: a short word is still found at its start, as before.
    expect(await search('기록')).toEqual(['회의 기록을 작성하다'])
    // Accents and case, and a word inside a compound.
    expect(await search('cancion')).toEqual(['Canción'])
    expect(await search('istanbul')).toEqual(['Viaje a İstanbul'])
    expect(await search('plan')).toEqual(['Projektplan'])
    // Several terms, each looked for its own way: all of them must be there.
    expect(await search('会議 作成')).toEqual(['会議の議事録を作成する'])
    expect(await search('会議 记录')).toEqual([])
  })

  it('reads terms with punctuation or loose accents as words, and leaves out what only an id in a link has', async () => {
    const { client, workspaceId } = await signUp(h, 'Casos')
    const { projectId, columns } = await seedBoard(client, workspaceId)
    const found = async (q: string) =>
      (await client.get(`/api/workspaces/${workspaceId}/search?q=${encodeURIComponent(q)}`)).body as Array<{ title: string; excerpt: string }>
    const search = async (q: string) => (await found(q)).map((r) => r.title)
    const team = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Plan de l’équipe', description: 'Enviar un e mail al equipo' })).body
    await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Reunión 会議の準備', description: 'equipo okay' })
    // Yoruba: a grave accent NFC doesn't join to «ọ», and the trigram index leaves out.
    await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'M\u1ecd\u0300r\u00e0n rere' })
    await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Notas tailandesas', description: `${'อื่น ๆ '.repeat(40)}บันทึกสำคัญ ที่นี่` })
    await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Notas coreanas', description: `${'다른 내용 '.repeat(30)}회의기록입니다 끝` })
    await client.post(`/api/projects/${projectId}/pages`, { title: 'Enlaces', content: `Ver [la tarea](/card/${team.id}).` })

    // With an apostrophe or a hyphen, as the word index reads them: «l’équipe» and «e mail» too.
    expect(await search("l'équipe")).toEqual(['Plan de l’équipe'])
    expect(await search('e-mail')).toEqual(['Plan de l’équipe'])
    expect(await search('m\u1ecd\u0300')).toEqual(['M\u1ecd\u0300r\u00e0n rere'])
    // Terms of each kind together: anywhere, read as they are, at the start of a word.
    expect(await search('equipo 会議')).toEqual(['Reunión 会議の準備'])
    expect(await search('ok 会議')).toEqual(['Reunión 会議の準備'])
    // The id of the card the page links to is in its Markdown, but isn't what the page says.
    expect(await search(team.id.slice(0, 8))).toEqual([])
    expect(await search('Enlaces')).toEqual(['Enlaces'])
    // Many pages found by the id alone, ahead of one that has the term: that one is still found.
    for (let i = 0; i < 20; i++) await client.post(`/api/projects/${projectId}/pages`, { title: `Enlace ${i}`, content: `[a](/card/${team.id}) [b](/card/${team.id})` })
    await client.post(`/api/projects/${projectId}/pages`, { title: 'Código', content: `${'texto '.repeat(50)}ref ${team.id.slice(0, 8)}` })
    expect(await search(team.id.slice(0, 8))).toEqual(['Código'])
    // The excerpt shows the term, also where folding the text changes its length (Thai marks, Korean syllables).
    expect((await found('สำคัญ'))[0]?.excerpt).toContain('บันทึกสำคัญ')
    expect((await found('기록입니다'))[0]?.excerpt).toContain('회의기록입니다')
    // A control character in the query is left out.
    expect((await client.get(`/api/workspaces/${workspaceId}/search?q=abc%00`)).status).toBe(200)
  })

  it('finds comments and ranks titles first with terms read as they are', async () => {
    const { client, workspaceId } = await signUp(h, 'Comentarios CJK')
    const { columns } = await seedBoard(client, workspaceId)
    const search = async (q: string) =>
      ((await client.get(`/api/workspaces/${workspaceId}/search?q=${encodeURIComponent(q)}&type=card`)).body as Array<{ title: string; comment?: unknown }>).map(
        (r) => `${r.title}${r.comment ? ' (comentario)' : ''}`,
      )
    await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: '准备材料', description: '下周的会议需要' })
    await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: '会议安排' })
    const commented = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: '其他' })
    await client.post(`/api/cards/${commented.body.id}/comments`, { body: '请看会议纪要' })
    // The title first, then the description, then what a comment says.
    expect(await search('会议')).toEqual(['会议安排', '准备材料', '其他 (comentario)'])
    expect(await search('会议纪要')).toEqual(['其他 (comentario)'])
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
    expect((await client.del(`/api/projects/${projectId}`)).status).toBe(200)
    // A full scan of the index per deleted page would take several seconds here.
    expect(Date.now() - started).toBeLessThan(1000)
    expect((await client.get(`/api/workspaces/${workspaceId}/search?q=nota&type=page`)).body).toEqual([])
    // Restoring it from the trash puts the 8000 pages back, and in search. Indexing them takes
    // about a second by itself; a lookup per page that scanned a table would take far longer.
    const [entry] = (await client.get(`/api/workspaces/${workspaceId}/trash`)).body
    const restoring = Date.now()
    expect((await client.post(`/api/trash/${entry.trashId}/restore`)).status).toBe(200)
    expect(Date.now() - restoring).toBeLessThan(5000)
    expect((await client.get(`/api/workspaces/${workspaceId}/search?q=${encodeURIComponent('nota 7999')}&type=page`)).body).toHaveLength(1)
  })

  it('deletes deep page trees whole, with their links, attachments and search entries', async () => {
    const { client, workspaceId } = await signUp(h, 'Raíz')
    const { projectId, columns } = await seedBoard(client, workspaceId)
    const card = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Enlazada' })
    const left = (ids: string[]) => h.db.select({ id: pages.id }).from(pages).where(inList(pages.id, ids)).all()

    // A page with 119 levels under it, a card reference halfway down and a file at the bottom.
    const tree = await createPageChain(client, projectId, 120)
    await client.patch(`/api/pages/${tree[60]}`, { content: `Ver [Enlazada](/card/${card.body.id}), honduras`, baseVersion: 1 })
    expect((await client.upload(`/api/pages/${tree.at(-1)}/attachments`, 'fondo', { name: 'fondo.txt', type: 'text/plain' })).status).toBe(201)
    expect((await client.get(`/api/cards/${card.body.id}`)).body.pages).toHaveLength(1)
    expect((await client.del(`/api/pages/${tree[0]}`)).status).toBe(200)
    expect(left(tree)).toEqual([])
    expect(h.db.select().from(attachments).where(inList(attachments.pageId, tree)).all()).toEqual([])
    expect((await client.get(`/api/cards/${card.body.id}`)).body.pages).toEqual([])
    expect((await client.get(`/api/workspaces/${workspaceId}/search?q=honduras&type=page`)).body).toEqual([])

    // Deleting a subpage leaves its parent and siblings alone.
    const [top, middle] = await createPageChain(client, projectId, 3)
    const sibling = await client.post(`/api/projects/${projectId}/pages`, { title: 'Hermana', parentId: top })
    expect((await client.del(`/api/pages/${middle}`)).status).toBe(200)
    expect(left([top!, sibling.body.id]).map((p) => p.id).sort()).toEqual([top!, sibling.body.id].sort())

    // Projects and workspaces holding deep trees.
    const inProject = await createPageChain(client, projectId, 120)
    expect((await client.del(`/api/projects/${projectId}`)).status).toBe(200)
    expect(left([...inProject, top!])).toEqual([])
    const spare = await client.post('/api/workspaces', { name: 'Hondo' })
    const project = await client.post(`/api/workspaces/${spare.body.id}/projects`, { name: 'Pozo' })
    const inWorkspace = await createPageChain(client, project.body.id, 120)
    expect((await client.del(`/api/workspaces/${spare.body.id}`)).status).toBe(204)
    expect(left(inWorkspace)).toEqual([])
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
