import { TRASH_DAYS, type TrashNodeDTO, type TrashPlanDTO } from '@orqevio/shared'
import { eq, inArray } from 'drizzle-orm'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { attachments, pages, trash, trashRows } from '../src/db/schema'
import type { AttachmentStorage } from '../src/lib/storage'
import { LocalStorage } from '../src/lib/storage-local'
import { createServices } from '../src/services'
import { Client, type Harness, createHarness, createPageChain, seedBoard, signUp } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => h.close())

const listTrash = async (client: Client, workspaceId: string) => (await client.get(`/api/workspaces/${workspaceId}/trash`)).body as TrashNodeDTO[]
const plan = async (client: Client, workspaceId: string, body: Record<string, unknown>) =>
  (await client.post(`/api/workspaces/${workspaceId}/trash/restore`, { ...body, dryRun: true })).body as TrashPlanDTO
const restoreItem = (client: Client, workspaceId: string, body: Record<string, unknown>) => client.post(`/api/workspaces/${workspaceId}/trash/restore`, body)
const storedFile = (key: string) => path.join(h.env.dataDir, 'uploads', key)
const keyOf = (attachmentId: string) => h.db.select({ key: attachments.storageKey }).from(attachments).where(eq(attachments.id, attachmentId)).get()!.key

/** A card with a label, a checklist, a page linked to it and a file. */
async function fullCard(client: Client, workspaceId: string) {
  const { projectId, boardId, columns } = await seedBoard(client, workspaceId)
  const label = await client.post(`/api/boards/${boardId}/labels`, { name: 'Urgente', color: 'tomato' })
  const card = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Revisar contrato' })
  const cardId = card.body.id as string
  await client.patch(`/api/cards/${cardId}`, { labelIds: [label.body.id], description: 'Cláusulas de penalización' })
  const list = await client.post(`/api/cards/${cardId}/checklists`, { title: 'Pasos' })
  await client.post(`/api/checklists/${list.body.id}/items`, { text: 'Leer' })
  await client.post(`/api/checklists/${list.body.id}/items`, { text: 'Firmar' })
  const page = await client.post(`/api/projects/${projectId}/pages`, { title: 'Contrato' })
  await client.post(`/api/cards/${cardId}/pages`, { pageId: page.body.id })
  const file = await client.upload(`/api/cards/${cardId}/attachments`, 'contenido del contrato', { name: 'contrato.txt', type: 'text/plain' })
  return { projectId, boardId, columns, cardId, labelId: label.body.id as string, checklistId: list.body.id as string, pageId: page.body.id as string, attachmentId: file.body.id as string }
}

describe('the trash', () => {
  it('keeps a deleted card with everything on it, and puts it all back', async () => {
    const { client, workspaceId } = await signUp(h)
    const c = await fullCard(client, workspaceId)
    const key = keyOf(c.attachmentId)

    const deleted = await client.del(`/api/cards/${c.cardId}`)
    expect(deleted.status).toBe(200)
    expect(deleted.body.trashId).toEqual(expect.any(String))
    // Gone from everywhere: the board, the card, its file, its page and search…
    expect((await client.get(`/api/boards/${c.boardId}`)).body.cards).toEqual([])
    expect((await client.get(`/api/cards/${c.cardId}`)).status).toBe(404)
    expect((await client.get(`/api/attachments/${c.attachmentId}`)).status).toBe(404)
    expect((await client.get(`/api/pages/${c.pageId}`)).body.cards).toEqual([])
    expect((await client.get(`/api/workspaces/${workspaceId}/search?q=penalización`)).body).toEqual([])
    // …but the file stays, and the sweep keeps it.
    expect(existsSync(storedFile(key))).toBe(true)
    expect(h.services.attachments.usesFile(key)).toBe(true)
    expect(await new LocalStorage(path.join(h.env.dataDir, 'uploads')).sweep(async (k) => h.services.attachments.usesFile(k), 0)).toBe(0)

    const [entry] = await listTrash(client, workspaceId)
    expect(entry).toMatchObject({
      key: `card:${c.cardId}`,
      trashId: deleted.body.trashId,
      kind: 'card',
      entityId: c.cardId,
      title: 'Revisar contrato',
      location: 'Lanzamiento › Producto › To do',
      contents: { checklists: 1, items: 2, attachments: 1 },
      bytes: 'contenido del contrato'.length,
      deletedBy: { kind: 'user', name: 'Ana López' },
    })
    expect(new Date(entry!.expiresAt).getTime() - new Date(entry!.deletedAt).getTime()).toBe(TRASH_DAYS * 24 * 60 * 60 * 1000)

    const restored = await client.post(`/api/trash/${entry!.trashId}/restore`)
    expect(restored.status).toBe(200)
    expect(restored.body).toMatchObject({ kind: 'card', entityId: c.cardId, movedTo: null, path: `b/${c.boardId}`, location: 'Lanzamiento › Producto › To do' })
    const card = (await client.get(`/api/cards/${c.cardId}`)).body
    expect(card.title).toBe('Revisar contrato')
    expect(card.labelIds).toEqual([c.labelId])
    expect(card.checklists[0].items.map((i: { text: string }) => i.text)).toEqual(['Leer', 'Firmar'])
    expect(card.pages.map((p: { id: string }) => p.id)).toEqual([c.pageId])
    expect(card.attachmentList.map((a: { id: string }) => a.id)).toEqual([c.attachmentId])
    expect((await client.get(`/api/attachments/${c.attachmentId}`)).body).toBe('contenido del contrato')
    expect((await client.get(`/api/workspaces/${workspaceId}/search?q=penalización`)).body.map((r: { id: string }) => r.id)).toEqual([c.cardId])
    expect(await listTrash(client, workspaceId)).toEqual([])
    expect(card.activity.map((a: { action: string }) => a.action)).toContain('trash.restored')
  })

  it('keeps a card deleted before its column inside the column, and puts nothing anywhere else', async () => {
    const { client, workspaceId } = await signUp(h, 'Columnas')
    const { boardId, columns } = await seedBoard(client, workspaceId)
    const card = await client.post(`/api/columns/${columns[1]!.id}/cards`, { title: 'Suelta' })
    const kept = await client.post(`/api/columns/${columns[1]!.id}/cards`, { title: 'Con su columna' })
    await client.post(`/api/cards/${kept.body.id}/archive`)
    const cardTrash = (await client.del(`/api/cards/${card.body.id}`)).body.trashId
    const columnTrash = (await client.del(`/api/columns/${columns[1]!.id}`)).body.trashId
    const top = await listTrash(client, workspaceId)
    expect(top.map((n) => n.key)).toEqual([`column:${columns[1]!.id}`])
    expect(top[0]).toMatchObject({ trashId: columnTrash, place: 'original', contents: { cards: 2 }, earlierContents: { cards: 1 } })
    const tree = (await client.get(`/api/workspaces/${workspaceId}/trash/card:${card.body.id}`)).body
    expect(tree).toMatchObject({ node: { title: 'Suelta', place: 'trash', earlier: true, parentKey: `column:${columns[1]!.id}` }, ancestors: [{ key: `column:${columns[1]!.id}`, kind: 'column', title: 'In progress', trashId: columnTrash }] })

    // Undoing the card's deletion can't put it anywhere else: its column comes first.
    const early = await client.post(`/api/trash/${cardTrash}/restore`)
    expect(early.body.error).toMatchObject({ code: 'restore_place_in_trash', details: { title: 'In progress', key: `column:${columns[1]!.id}` } })
    // Undoing the column's brings it back as it was when it went, with its archived card; the
    // card deleted before stays in the trash, now at the top, and goes back to its column.
    expect((await client.post(`/api/trash/${columnTrash}/restore`)).body).toMatchObject({ movedTo: null, restored: 1, left: 1 })
    const after = (await client.get(`/api/boards/${boardId}`)).body
    expect(after.columns.map((x: { id: string }) => x.id)).toEqual(columns.map((x) => x.id))
    expect((await client.get(`/api/boards/${boardId}/archived`)).body.map((x: { id: string }) => x.id)).toEqual([kept.body.id])
    expect((await listTrash(client, workspaceId)).map((n) => [n.key, n.place])).toEqual([[`card:${card.body.id}`, 'original']])
    expect((await client.post(`/api/trash/${cardTrash}/restore`)).body).toMatchObject({ movedTo: null, location: 'Lanzamiento › Producto › In progress' })
    expect((await client.get(`/api/cards/${card.body.id}`)).body.column.id).toBe(columns[1]!.id)
  })

  it('keeps a deep page tree with its files and links, and puts subpages at the top when their parent is gone', async () => {
    const { client, workspaceId } = await signUp(h, 'Árbol')
    const { projectId, columns } = await seedBoard(client, workspaceId)
    const card = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Mencionada' })
    const tree = await createPageChain(client, projectId, 50)
    await client.patch(`/api/pages/${tree[25]}`, { content: `Ver [Mencionada](/card/${card.body.id})`, baseVersion: 1 })
    const file = await client.upload(`/api/pages/${tree.at(-1)}/attachments`, 'fondo', { name: 'fondo.txt', type: 'text/plain' })
    const left = () => h.db.select({ id: pages.id }).from(pages).where(inArray(pages.id, tree)).all().length

    const trashId = (await client.del(`/api/pages/${tree[0]}`)).body.trashId
    expect(left()).toBe(0)
    expect((await listTrash(client, workspaceId))[0]).toMatchObject({ kind: 'page', title: 'Nivel 1', location: 'Lanzamiento', contents: { pages: 49, attachments: 1 } })
    expect((await client.post(`/api/trash/${trashId}/restore`)).status).toBe(200)
    expect(left()).toBe(50)
    expect((await client.get(`/api/pages/${tree[1]}`)).body.parentId).toBe(tree[0])
    expect((await client.get(`/api/cards/${card.body.id}`)).body.pages.map((p: { id: string }) => p.id)).toEqual([tree[25]])
    expect((await client.get(`/api/attachments/${file.body.id}`)).body).toBe('fondo')

    // A subpage deleted on its own, then its parent: the subpage waits inside it. Restoring it
    // brings back the pages above it, and only them; the rest of the tree stays in the trash.
    const sub = (await client.del(`/api/pages/${tree[10]}`)).body.trashId
    await client.del(`/api/pages/${tree[0]}`)
    expect((await client.post(`/api/trash/${sub}/restore`)).body.error.code).toBe('restore_place_in_trash')
    const asked = await plan(client, workspaceId, { key: `page:${tree[10]}` })
    expect(asked.where).toMatchObject({ place: 'trash', to: 'recreate', canRecreate: true, choose: ['project', 'page'] })
    expect(asked.where.path.map((p) => p.key)).toEqual(tree.slice(0, 10).map((id) => `page:${id}`))
    expect(asked.where.location).toBe(['Lanzamiento', ...Array.from({ length: 10 }, (_, i) => `Nivel ${i + 1}`)].join(' › '))
    expect(asked.nodes).toHaveLength(41)
    const back = await restoreItem(client, workspaceId, { key: `page:${tree[10]}` })
    expect(back.body).toMatchObject({ kind: 'page', entityId: tree[10], movedTo: null, path: `d/${tree[10]}`, restored: 50, left: 0 })
    expect((await client.get(`/api/pages/${tree[10]}`)).body.parentId).toBe(tree[9])
    expect(left()).toBe(50)
    // The parent's deletion held only the pages above it: nothing is left in the trash.
    expect((await client.get(`/api/pages/${tree[0]}`)).status).toBe(200)
    expect(await listTrash(client, workspaceId)).toEqual([])
  })

  it('keeps a whole project, and a board whose project is in the trash goes back only with it, or where it is put', async () => {
    const { client, workspaceId } = await signUp(h, 'Proyecto')
    const c = await fullCard(client, workspaceId)
    const subpage = await client.post(`/api/projects/${c.projectId}/pages`, { title: 'Anexo', parentId: c.pageId })
    const pagesOf = async () => (await client.get(`/api/cards/${c.cardId}`)).body.pages.map((p: { id: string }) => p.id)
    let boardTrash = (await client.del(`/api/boards/${c.boardId}`)).body.trashId
    let projectTrash = (await client.del(`/api/projects/${c.projectId}`)).body.trashId
    expect(await listTrash(client, workspaceId)).toMatchObject([{ kind: 'project', title: 'Lanzamiento', contents: { boards: 1, pages: 2 }, earlierContents: { boards: 1 } }])

    // The board's project is in the trash too: restore that first.
    const early = await client.post(`/api/trash/${boardTrash}/restore`)
    expect(early.body.error).toMatchObject({ code: 'restore_place_in_trash', details: { title: 'Lanzamiento' } })
    expect((await client.post(`/api/trash/${projectTrash}/restore`)).body).toMatchObject({ left: 1 })
    expect((await client.post(`/api/trash/${boardTrash}/restore`)).body.movedTo).toBeNull()
    expect((await client.get(`/api/pages/${subpage.body.id}`)).body.parentId).toBe(c.pageId)
    expect(await pagesOf()).toEqual([c.pageId])

    // With another project around, it never goes there by itself: only where it is put.
    const other = await client.post(`/api/workspaces/${workspaceId}/projects`, { name: 'Otro' })
    boardTrash = (await client.del(`/api/boards/${c.boardId}`)).body.trashId
    projectTrash = (await client.del(`/api/projects/${c.projectId}`)).body.trashId
    expect((await client.post(`/api/trash/${boardTrash}/restore`)).body.error.code).toBe('restore_place_in_trash')
    const where = { kind: 'other', parent: { kind: 'project', id: other.body.id } }
    const asked = await plan(client, workspaceId, { key: `board:${c.boardId}`, to: where })
    expect(asked).toMatchObject({ ready: true, where: { to: 'other', location: 'Otro' } })
    // Its card's link to a page still in the trash waits for the page.
    expect(asked.relations).toEqual([expect.objectContaining({ kind: 'page', title: 'Contrato', state: 'trash', count: 1, first: 'Revisar contrato', canInclude: false, included: false })])
    const moved = await restoreItem(client, workspaceId, { key: `board:${c.boardId}`, to: where })
    expect(moved.body).toMatchObject({ movedTo: 'Otro', location: 'Otro', path: `b/${c.boardId}` })
    expect((await client.get(`/api/boards/${c.boardId}`)).body.projectId).toBe(other.body.id)
    expect(await pagesOf()).toEqual([])
    // The page back, the link is there again.
    expect((await client.post(`/api/trash/${projectTrash}/restore`)).status).toBe(200)
    expect((await client.get(`/api/pages/${c.pageId}`)).body.title).toBe('Contrato')
    expect(await pagesOf()).toEqual([c.pageId])
  })

  it('keeps labels, checklists, items, links and files deleted on their own', async () => {
    const { client, workspaceId } = await signUp(h, 'Piezas')
    const c = await fullCard(client, workspaceId)
    const detail = async () => (await client.get(`/api/cards/${c.cardId}`)).body
    const itemId = (await detail()).checklists[0].items[0].id

    const label = (await client.del(`/api/labels/${c.labelId}`)).body.trashId
    const item = (await client.del(`/api/checklist-items/${itemId}`)).body.trashId
    const list = (await client.del(`/api/checklists/${c.checklistId}`)).body.trashId
    const link = (await client.del(`/api/cards/${c.cardId}/pages/${c.pageId}`)).body.trashId
    const file = (await client.del(`/api/attachments/${c.attachmentId}`)).body.trashId
    expect((await client.del(`/api/cards/${c.cardId}/pages/${c.pageId}`)).body).toEqual({ trashId: null })
    const card = await detail()
    expect([card.labelIds, card.checklists, card.pages, card.attachmentList]).toEqual([[], [], [], []])
    // The item went before its checklist: it waits inside it.
    expect((await listTrash(client, workspaceId)).map((e) => [e.kind, e.title, e.location, e.contents])).toEqual([
      ['attachment', 'contrato.txt', 'Lanzamiento › Producto › Revisar contrato', {}],
      ['link', 'Contrato', 'Lanzamiento › Producto › Revisar contrato', {}],
      ['checklist', 'Pasos', 'Lanzamiento › Producto › Revisar contrato', { items: 2 }],
      ['label', 'Urgente', 'Lanzamiento › Producto', {}],
    ])

    // An item needs its checklist: restore that first.
    const early = await client.post(`/api/trash/${item}/restore`)
    expect(early.status).toBe(409)
    expect(early.body.error).toMatchObject({ code: 'restore_place_in_trash', details: { title: 'Pasos' } })
    for (const id of [list, item, label, link, file]) expect((await client.post(`/api/trash/${id}/restore`)).status).toBe(200)
    const back = await detail()
    expect(back.labelIds).toEqual([c.labelId])
    expect(back.checklists[0].items.map((i: { text: string }) => i.text).sort()).toEqual(['Firmar', 'Leer'])
    expect(back.pages.map((p: { id: string }) => p.id)).toEqual([c.pageId])
    expect(back.attachmentList.map((a: { id: string }) => a.id)).toEqual([c.attachmentId])
  })

  it('puts a card in its column wherever that was put, and says a label of another board does not apply', async () => {
    const { client, workspaceId } = await signUp(h, 'Orden')
    const first = await seedBoard(client, workspaceId)
    const second = (await client.post(`/api/projects/${first.projectId}/boards`, { name: 'Destino' })).body.id as string
    const column = first.columns[1]!.id
    const label = (await client.post(`/api/boards/${first.boardId}/labels`, { name: 'Roja', color: 'tomato' })).body.id
    const card = (await client.post(`/api/columns/${column}/cards`, { title: 'Viajera' })).body.id
    await client.patch(`/api/cards/${card}`, { labelIds: [label] })
    const cardTrash = (await client.del(`/api/cards/${card}`)).body.trashId
    await client.del(`/api/columns/${column}`)
    const boardTrash = (await client.del(`/api/boards/${first.boardId}`)).body.trashId

    // The column, without the card, put on the other board; then its own board, with its label.
    const where = { kind: 'other', parent: { kind: 'board', id: second } }
    const asked = await plan(client, workspaceId, { key: `column:${column}`, to: where, exclude: [`card:${card}`] })
    expect(asked.nodes.map((n) => [n.key, n.earlier, n.included])).toEqual([
      [`column:${column}`, false, true],
      [`card:${card}`, true, false],
    ])
    // The other board has an “In progress” of its own: it asks first, then keeps the name as asked.
    expect(asked.conflicts).toEqual([{ key: `column:${column}`, kind: 'column', original: 'In progress', name: 'In progress', where: 'Destino', taken: true, kept: false }])
    expect((await restoreItem(client, workspaceId, { key: `column:${column}`, to: where, exclude: [`card:${card}`] })).body.error).toMatchObject({ code: 'restore_incomplete', details: { missing: ['names'] } })
    const columnBack = await restoreItem(client, workspaceId, { key: `column:${column}`, to: where, exclude: [`card:${card}`], keepNames: [`column:${column}`] })
    expect(columnBack.body).toMatchObject({
      movedTo: 'Lanzamiento › Destino',
      left: 1,
    })
    expect((await client.post(`/api/trash/${boardTrash}/restore`)).status).toBe(200)
    // The card follows its column; its label is of the board it no longer is on.
    const cardPlan = await plan(client, workspaceId, { key: `card:${card}` })
    expect(cardPlan.relations).toEqual([expect.objectContaining({ kind: 'label', title: 'Roja', state: 'other_board', count: 1 })])
    const back = await client.post(`/api/trash/${cardTrash}/restore`)
    expect(back.body).toMatchObject({ location: 'Lanzamiento › Destino › In progress', path: `b/${second}` })
    const detail = (await client.get(`/api/cards/${card}`)).body
    expect([detail.board.id, detail.column.id, detail.labelIds]).toEqual([second, column, []])
    expect((await client.get(`/api/boards/${second}`)).body.cards.map((c: { id: string }) => c.id)).toEqual([card])
  })

  it('offers what lost its place for good before 1.3.0 a place to choose, or makes the one level above it anew', async () => {
    const { client, workspaceId } = await signUp(h, 'Huérfanas')
    const gone = await seedBoard(client, workspaceId)
    const full = (await client.post(`/api/projects/${gone.projectId}/boards`, { name: 'Lleno' })).body.id as string
    const target = (await client.get(`/api/boards/${full}`)).body.columns[0].id as string
    // As 1.2.1 left it: a card deleted, then its board deleted for good, the card alone in the trash.
    const lonely = (await client.post(`/api/columns/${gone.columns[0]!.id}/cards`, { title: 'Huérfana' })).body.id
    const lonelyTrash = (await client.del(`/api/cards/${lonely}`)).body.trashId
    const boardTrash = (await client.del(`/api/boards/${gone.boardId}`)).body.trashId
    h.db.delete(trash).where(eq(trash.id, boardTrash)).run()

    expect(await listTrash(client, workspaceId)).toMatchObject([{ key: `card:${lonely}`, place: 'gone', location: 'Lanzamiento › Producto › To do' }])
    expect((await client.post(`/api/trash/${lonelyTrash}/restore`)).body.error.code).toBe('restore_place_gone')
    // Its board is gone too: nothing to make anew, only a place to choose.
    const asked = await plan(client, workspaceId, { key: `card:${lonely}` })
    expect(asked).toMatchObject({ ready: false, missing: ['place'], where: { place: 'gone', to: null, canRecreate: false, choose: ['column'], location: '' } })
    expect((await restoreItem(client, workspaceId, { key: `card:${lonely}` })).body.error).toMatchObject({ code: 'restore_incomplete', details: { missing: ['place'] } })
    const put = await restoreItem(client, workspaceId, { key: `card:${lonely}`, to: { kind: 'other', parent: { kind: 'column', id: target } } })
    expect(put.body).toMatchObject({ movedTo: 'Lanzamiento › Lleno › To do', path: `b/${full}` })
    expect((await client.get(`/api/cards/${lonely}`)).body.board.id).toBe(full)

    // A card whose column went for good, on a board that is there: its column made anew, by name.
    const column = (await client.post(`/api/boards/${full}/columns`, { name: 'Revisión' })).body.id as string
    const card = (await client.post(`/api/columns/${column}/cards`, { title: 'Sin columna' })).body.id
    await client.del(`/api/cards/${card}`)
    h.db.delete(trash).where(eq(trash.id, (await client.del(`/api/columns/${column}`)).body.trashId)).run()
    const remade = await plan(client, workspaceId, { key: `card:${card}` })
    expect(remade.where).toMatchObject({ place: 'gone', to: 'recreate', canRecreate: true, create: [{ kind: 'column', title: 'Revisión' }], location: 'Lanzamiento › Lleno › Revisión' })
    const back = await restoreItem(client, workspaceId, { key: `card:${card}` })
    expect(back.body).toMatchObject({ movedTo: 'Lanzamiento › Lleno › Revisión' })
    const detail = (await client.get(`/api/cards/${card}`)).body
    expect([detail.board.id, detail.column.name]).toEqual([full, 'Revisión'])
    expect(detail.column.id).not.toBe(column)

    // A board whose project went for good: a project made anew with its name.
    const project = (await client.post(`/api/workspaces/${workspaceId}/projects`, { name: 'Efímero' })).body.id as string
    const board = (await client.post(`/api/projects/${project}/boards`, { name: 'Superviviente' })).body.id as string
    await client.del(`/api/boards/${board}`)
    h.db.delete(trash).where(eq(trash.id, (await client.del(`/api/projects/${project}`)).body.trashId)).run()
    expect((await plan(client, workspaceId, { key: `board:${board}` })).where).toMatchObject({ to: 'recreate', create: [{ kind: 'project', title: 'Efímero' }], location: 'Efímero' })
    expect((await restoreItem(client, workspaceId, { key: `board:${board}` })).status).toBe(200)
    const restored = (await client.get(`/api/boards/${board}`)).body
    expect(restored.projectId).not.toBe(project)
    const projects = (await client.get(`/api/workspaces/${workspaceId}/overview`)).body.projects as { id: string; name: string }[]
    expect(projects.find((p) => p.id === restored.projectId)?.name).toBe('Efímero')
  })

  it('brings a page back with its project and the subpage deleted before, or puts them where chosen', async () => {
    const { client, workspaceId } = await signUp(h, 'Ramas')
    const { projectId } = await seedBoard(client, workspaceId)
    const [parent, child] = await createPageChain(client, projectId, 2)
    await client.del(`/api/pages/${child}`)
    await client.del(`/api/pages/${parent}`)
    const projectTrash = (await client.del(`/api/projects/${projectId}`)).body.trashId
    const other = (await client.post(`/api/workspaces/${workspaceId}/projects`, { name: 'Refugio' })).body.id

    const asked = await plan(client, workspaceId, { key: `page:${parent}` })
    expect(asked.where).toMatchObject({ place: 'trash', to: 'recreate', path: [{ key: `project:${projectId}`, title: 'Lanzamiento' }], location: 'Lanzamiento' })
    expect(asked.nodes.map((n) => [n.key, n.earlier])).toEqual([
      [`page:${parent}`, false],
      [`page:${child}`, true],
    ])
    // Somewhere else: the page and its subpage, there.
    const moved = await restoreItem(client, workspaceId, { key: `page:${parent}`, to: { kind: 'other', parent: { kind: 'project', id: other } } })
    expect(moved.body).toMatchObject({ movedTo: 'Refugio', restored: 1 })
    const page = (await client.get(`/api/pages/${child}`)).body
    expect([page.projectId, page.parentId]).toEqual([other, parent])
    const tree = (await client.get(`/api/projects/${other}/pages`)).body.map((p: { id: string; parentId: string | null }) => `${p.id}<${p.parentId}`)
    expect(tree.sort()).toEqual([`${parent}<null`, `${child}<${parent}`].sort())
    // The project, still in the trash, holds its board.
    expect((await listTrash(client, workspaceId)).map((n) => [n.key, n.trashId, n.contents])).toEqual([[`project:${projectId}`, projectTrash, { boards: 1, columns: 3 }]])
  })

  it('rebuilds mentions from what pages say now', async () => {
    const { client, workspaceId } = await signUp(h, 'Menciones')
    const { projectId, columns } = await seedBoard(client, workspaceId)
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Citada' })).body
    const mention = `Ver [Citada](/card/${card.id})`
    const kept = (await client.post(`/api/projects/${projectId}/pages`, { title: 'La sigue citando' })).body
    const edited = (await client.post(`/api/projects/${projectId}/pages`, { title: 'Ya no la cita' })).body
    await client.patch(`/api/pages/${kept.id}`, { content: mention, baseVersion: 1 })
    await client.patch(`/api/pages/${edited.id}`, { content: mention, baseVersion: 1 })
    expect((await client.get(`/api/cards/${card.id}`)).body.pages).toHaveLength(2)

    const trashId = (await client.del(`/api/cards/${card.id}`)).body.trashId
    await client.patch(`/api/pages/${edited.id}`, { content: 'Sin la tarjeta', baseVersion: 2 })
    expect((await client.post(`/api/trash/${trashId}/restore`)).status).toBe(200)
    expect((await client.get(`/api/cards/${card.id}`)).body.pages.map((p: { id: string }) => p.id)).toEqual([kept.id])
    expect((await client.get(`/api/pages/${edited.id}`)).body.cards).toEqual([])

    // A page that starts mentioning it while it is in the trash links it once it's back.
    const again = (await client.del(`/api/cards/${card.id}`)).body.trashId
    const fresh = (await client.post(`/api/projects/${projectId}/pages`, { title: 'La cita después' })).body
    await client.patch(`/api/pages/${fresh.id}`, { content: mention, baseVersion: 1 })
    expect((await client.get(`/api/pages/${fresh.id}`)).body.cards).toEqual([])
    expect((await client.post(`/api/trash/${again}/restore`)).status).toBe(200)
    expect((await client.get(`/api/cards/${card.id}`)).body.pages.map((p: { id: string }) => p.id).sort()).toEqual([kept.id, fresh.id].sort())
  })

  it('deletes for good on request or after the time is up, files included', async () => {
    const { client, workspaceId } = await signUp(h, 'Vaciar')
    const c = await fullCard(client, workspaceId)
    const key = keyOf(c.attachmentId)
    const first = (await client.del(`/api/attachments/${c.attachmentId}`)).body.trashId
    expect((await client.del(`/api/trash/${first}`)).status).toBe(204)
    expect(existsSync(storedFile(key))).toBe(false)
    expect(await listTrash(client, workspaceId)).toEqual([])
    expect((await client.post(`/api/trash/${first}/restore`)).status).toBe(404)

    const page = (await client.del(`/api/pages/${c.pageId}`)).body.trashId
    expect(await h.services.trash.purgeExpired(new Date(Date.now() + (TRASH_DAYS - 1) * 86_400_000))).toBe(0)
    expect(await h.services.trash.purgeExpired(new Date(Date.now() + TRASH_DAYS * 86_400_000 + 1000))).toBeGreaterThanOrEqual(1)
    expect(h.db.select().from(trash).where(eq(trash.id, page)).all()).toEqual([])
    expect(h.db.select().from(trashRows).where(eq(trashRows.trashId, page)).all()).toEqual([])
  })

  it('keeps a file the hourly sweep checks while it is being restored', async () => {
    const { client, user, workspaceId } = await signUp(h, 'Barrido')
    const actor = { kind: 'user' as const, userId: user.id as string, name: user.name as string, sessionId: 'test' }
    const { columns } = await seedBoard(client, workspaceId)
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Barrido' })).body.id
    const file = (await client.upload(`/api/cards/${card}/attachments`, 'contenido', { name: 'a.txt', type: 'text/plain' })).body.id
    const key = keyOf(file)
    // A sweep that looks only at this file and deletes nothing, so every run takes the same steps.
    const orphans: string[] = []
    const storage = { sweep: async (isKnown: (key: string) => Promise<boolean>) => ((await isKnown(key)) ? 0 : orphans.push(key)) } as unknown as AttachmentStorage
    const sweeper = createServices({ db: h.db, bus: h.bus, env: h.env, storage }).attachments
    const ticks = async (n: number) => {
      for (let i = 0; i < n; i++) await null
    }
    // The restore lands at every step of the sweep's check, before and after it.
    for (let lead = -40; lead <= 40; lead++) {
      const trashId = await h.services.attachments.remove(actor, file)
      await Promise.all([
        ticks(Math.max(0, lead)).then(() => h.services.trash.restore(actor, trashId!)),
        ticks(Math.max(0, -lead)).then(() => sweeper.sweepOrphans()),
      ])
      expect({ lead, orphans }).toEqual({ lead, orphans: [] })
    }
  })

  it('either restores or deletes for good when both happen at once, never half of each', async () => {
    const { client, workspaceId } = await signUp(h, 'Carrera')
    const { columns } = await seedBoard(client, workspaceId)
    for (let i = 0; i < 10; i++) {
      const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: `Carrera ${i}` })).body.id
      const file = (await client.upload(`/api/cards/${card}/attachments`, `contenido ${i}`, { name: 'a.txt', type: 'text/plain' })).body.id
      const key = keyOf(file)
      const trashId = (await client.del(`/api/cards/${card}`)).body.trashId
      const [purged, restored] = await Promise.all([
        i % 2 ? h.services.trash.purgeExpired(new Date(Date.now() + 31 * 86_400_000)) : client.del(`/api/trash/${trashId}`).then((r) => r.status),
        client.post(`/api/trash/${trashId}/restore`).then((r) => r.status),
      ])
      const back = (await client.get(`/api/cards/${card}`)).status === 200
      // Exactly one of them won; a restored file is still there to read.
      expect([back, restored === 200]).toEqual([back, back])
      if (back) {
        expect(existsSync(storedFile(key))).toBe(true)
        expect((await client.get(`/api/attachments/${file}`)).body).toBe(`contenido ${i}`)
      } else {
        expect(existsSync(storedFile(key))).toBe(false)
        expect(purged === 204 || purged === 1).toBe(true)
      }
    }
  })

  it('belongs to people: agents and other members can neither see it nor restore from it', async () => {
    const { client, workspaceId } = await signUp(h, 'Dueña')
    const c = await fullCard(client, workspaceId)
    const trashId = (await client.del(`/api/cards/${c.cardId}`)).body.trashId
    const token = (await client.post('/api/tokens', { name: 'Claude', workspaceId, scopes: ['tasks:write', 'docs:write'], expiresInDays: 30 })).body.token
    const agent = new Client(h, token)
    expect((await agent.get(`/api/workspaces/${workspaceId}/trash`)).body.error.code).toBe('session_required')
    expect((await agent.post(`/api/trash/${trashId}/restore`)).status).toBe(403)
    expect((await agent.del(`/api/trash/${trashId}`)).status).toBe(403)
    // Without permission to delete and move, agents can't delete either.
    expect((await agent.del(`/api/pages/${c.pageId}`)).status).toBe(403)

    const { client: stranger } = await signUp(h, 'Ajena')
    expect((await stranger.get(`/api/workspaces/${workspaceId}/trash`)).status).toBe(404)
    expect((await stranger.post(`/api/trash/${trashId}/restore`)).status).toBe(404)
    expect((await stranger.del(`/api/trash/${trashId}`)).status).toBe(404)
    expect(await listTrash(client, workspaceId)).toHaveLength(1)
  })

  it('goes with its workspace', async () => {
    const { client } = await signUp(h, 'Espacio')
    const spare = await client.post('/api/workspaces', { name: 'Temporal' })
    const c = await fullCard(client, spare.body.id)
    const trashId = (await client.del(`/api/projects/${c.projectId}`)).body.trashId
    expect((await client.del(`/api/workspaces/${spare.body.id}`)).status).toBe(204)
    expect(h.db.select().from(trash).where(eq(trash.id, trashId)).all()).toEqual([])
    expect(h.db.select().from(trashRows).where(eq(trashRows.trashId, trashId)).all()).toEqual([])
  })
})
