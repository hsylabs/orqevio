import type { ActivityDTO, HistoryEntryDTO, TrashNodeDTO, TrashPlanDTO, TrashTreeDTO } from '@orqevio/shared'
import { eq } from 'drizzle-orm'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { attachments, history } from '../src/db/schema'
import { type Client, type Harness, createHarness, seedBoard, signUp } from './harness'

// The trash as a tree, and every case of something whose container or relation is in the trash
// too, or was deleted for good. Nothing goes back anywhere else than where it was, unless the
// person puts it there; nothing is lost without being said.
let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => h.close())

interface Ctx {
  client: Client
  workspaceId: string
}

const top = async ({ client, workspaceId }: Ctx) => (await client.get(`/api/workspaces/${workspaceId}/trash`)).body as TrashNodeDTO[]
const treeOf = async ({ client, workspaceId }: Ctx, key: string) => (await client.get(`/api/workspaces/${workspaceId}/trash/${key}`)).body as TrashTreeDTO
const plan = async ({ client, workspaceId }: Ctx, body: Record<string, unknown>) => (await client.post(`/api/workspaces/${workspaceId}/trash/restore`, { ...body, dryRun: true })).body as TrashPlanDTO
const restore = ({ client, workspaceId }: Ctx, body: Record<string, unknown>) => client.post(`/api/workspaces/${workspaceId}/trash/restore`, body)
const purge = ({ client, workspaceId }: Ctx, key: string) => client.del(`/api/workspaces/${workspaceId}/trash/${key}`)
const del = async (client: Client, url: string) => {
  const res = await client.del(url)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body.trashId as string
}

async function space(name: string): Promise<Ctx & { projectId: string; boardId: string; columns: { id: string; name: string }[] }> {
  const { client, workspaceId } = await signUp(h, name)
  // A first project, where 1.2.1 sent things whose place was gone.
  const first = await client.post(`/api/workspaces/${workspaceId}/projects`, { name: 'AAA otro proyecto', color: 'jade' })
  const firstBoard = (await client.post(`/api/projects/${first.body.id}/boards`, { name: 'Tablero ajeno' })).body.id as string
  await client.post(`/api/projects/${first.body.id}/pages`, { title: 'Página ajena' })
  const seeded = await seedBoard(client, workspaceId)
  void firstBoard
  return { client, workspaceId, ...seeded }
}

/**
 * Deletes something and then what holds it, and checks the rule: it waits inside its container,
 * undoing its deletion never puts it anywhere else, and restoring it from the trash brings back
 * the containers it needs, and only them.
 */
async function nested(ctx: Ctx, item: { url: string; key: string }, container: { url: string; key: string }) {
  const itemTrash = await del(ctx.client, item.url)
  await del(ctx.client, container.url)
  const tree = await treeOf(ctx, item.key)
  expect(tree.node).toMatchObject({ place: 'trash', earlier: true })
  expect(tree.ancestors.map((a) => a.key)).toContain(container.key)
  expect((await top(ctx)).map((n) => n.key)).not.toContain(item.key)
  const early = await ctx.client.post(`/api/trash/${itemTrash}/restore`)
  expect(early.status).toBe(409)
  expect(early.body.error.code).toBe('restore_place_in_trash')
  const asked = await plan(ctx, { key: item.key })
  expect(asked).toMatchObject({ ready: true, where: { place: 'trash', to: 'recreate', canRecreate: true } })
  expect(asked.where.path.map((p) => p.key)).toEqual(tree.ancestors.map((a) => a.key))
  const done = await restore(ctx, { key: item.key })
  expect(done.status, JSON.stringify(done.body)).toBe(200)
  expect(done.body.movedTo).toBeNull()
  return asked
}

describe('A. what was deleted before its container waits inside it, and comes back with its place', () => {
  it('A1 a board, then its project', async () => {
    const s = await space('A1')
    const asked = await nested(s, { url: `/api/boards/${s.boardId}`, key: `board:${s.boardId}` }, { url: `/api/projects/${s.projectId}`, key: `project:${s.projectId}` })
    expect(asked.where.location).toBe('Lanzamiento')
    expect((await s.client.get(`/api/boards/${s.boardId}`)).body.projectId).toBe(s.projectId)
  })

  it('A2 a column, then its board', async () => {
    const s = await space('A2')
    const column = s.columns[0]!.id
    await nested(s, { url: `/api/columns/${column}`, key: `column:${column}` }, { url: `/api/boards/${s.boardId}`, key: `board:${s.boardId}` })
    // Its board came back with it, and only it: the other columns are still in the trash.
    expect((await s.client.get(`/api/boards/${s.boardId}`)).body.columns.map((c: { id: string }) => c.id)).toEqual([column])
    expect((await top(s)).map((n) => n.key).sort()).toEqual(s.columns.slice(1).map((c) => `column:${c.id}`).sort())
  })

  it('A3 a card, then its column', async () => {
    const s = await space('A3')
    const card = (await s.client.post(`/api/columns/${s.columns[1]!.id}/cards`, { title: 'Tarea' })).body.id
    await nested(s, { url: `/api/cards/${card}`, key: `card:${card}` }, { url: `/api/columns/${s.columns[1]!.id}`, key: `column:${s.columns[1]!.id}` })
    expect((await s.client.get(`/api/cards/${card}`)).body.column.id).toBe(s.columns[1]!.id)
  })

  it('A4 a card, then its board', async () => {
    const s = await space('A4')
    const card = (await s.client.post(`/api/columns/${s.columns[0]!.id}/cards`, { title: 'Tarea' })).body.id
    const asked = await nested(s, { url: `/api/cards/${card}`, key: `card:${card}` }, { url: `/api/boards/${s.boardId}`, key: `board:${s.boardId}` })
    expect(asked.where.path.map((p) => p.kind)).toEqual(['board', 'column'])
    expect((await s.client.get(`/api/cards/${card}`)).body).toMatchObject({ board: { id: s.boardId }, column: { id: s.columns[0]!.id } })
  })

  it('A5 a card, then its project', async () => {
    const s = await space('A5')
    const card = (await s.client.post(`/api/columns/${s.columns[0]!.id}/cards`, { title: 'Tarea' })).body.id
    const asked = await nested(s, { url: `/api/cards/${card}`, key: `card:${card}` }, { url: `/api/projects/${s.projectId}`, key: `project:${s.projectId}` })
    expect(asked.where.path.map((p) => p.kind)).toEqual(['project', 'board', 'column'])
    expect(asked.where.location).toBe('Lanzamiento › Producto › To do')
    expect((await s.client.get(`/api/cards/${card}`)).body.board.id).toBe(s.boardId)
  })

  it('A6 a label, then its board', async () => {
    const s = await space('A6')
    const label = (await s.client.post(`/api/boards/${s.boardId}/labels`, { name: 'Urgente', color: 'tomato' })).body.id
    await nested(s, { url: `/api/labels/${label}`, key: `label:${label}` }, { url: `/api/boards/${s.boardId}`, key: `board:${s.boardId}` })
    expect((await s.client.get(`/api/boards/${s.boardId}`)).body.labels.map((l: { id: string }) => l.id)).toEqual([label])
  })

  async function cardWith(s: Awaited<ReturnType<typeof space>>) {
    const card = (await s.client.post(`/api/columns/${s.columns[0]!.id}/cards`, { title: 'Tarea' })).body.id as string
    const list = (await s.client.post(`/api/cards/${card}/checklists`, { title: 'Pasos' })).body.id as string
    const item = (await s.client.post(`/api/checklists/${list}/items`, { text: 'Paso 1' })).body.id as string
    return { card, list, item }
  }

  it('A7 a checklist, then its card', async () => {
    const s = await space('A7')
    const { card, list } = await cardWith(s)
    await nested(s, { url: `/api/checklists/${list}`, key: `checklist:${list}` }, { url: `/api/cards/${card}`, key: `card:${card}` })
    expect((await s.client.get(`/api/cards/${card}`)).body.checklists.map((c: { id: string }) => c.id)).toEqual([list])
  })

  it('A8 a checklist, then the board of its card', async () => {
    const s = await space('A8')
    const { card, list } = await cardWith(s)
    const asked = await nested(s, { url: `/api/checklists/${list}`, key: `checklist:${list}` }, { url: `/api/boards/${s.boardId}`, key: `board:${s.boardId}` })
    expect(asked.where.path.map((p) => p.kind)).toEqual(['board', 'column', 'card'])
    expect((await s.client.get(`/api/cards/${card}`)).body.checklists[0].items.map((i: { text: string }) => i.text)).toEqual(['Paso 1'])
  })

  it('A9 a checklist item, then its checklist', async () => {
    const s = await space('A9')
    const { card, list, item } = await cardWith(s)
    await nested(s, { url: `/api/checklist-items/${item}`, key: `checklist_item:${item}` }, { url: `/api/checklists/${list}`, key: `checklist:${list}` })
    expect((await s.client.get(`/api/cards/${card}`)).body.checklists[0].items.map((i: { id: string }) => i.id)).toEqual([item])
  })

  it('A10 a checklist item, then its card', async () => {
    const s = await space('A10')
    const { card, item } = await cardWith(s)
    await nested(s, { url: `/api/checklist-items/${item}`, key: `checklist_item:${item}` }, { url: `/api/cards/${card}`, key: `card:${card}` })
    expect((await s.client.get(`/api/cards/${card}`)).body.checklists[0].items.map((i: { id: string }) => i.id)).toEqual([item])
  })

  it('A11 a file of a card, then the card', async () => {
    const s = await space('A11')
    const card = (await s.client.post(`/api/columns/${s.columns[0]!.id}/cards`, { title: 'Tarea' })).body.id
    const file = (await s.client.upload(`/api/cards/${card}/attachments`, 'hola', { name: 'nota.txt', type: 'text/plain' })).body.id
    await nested(s, { url: `/api/attachments/${file}`, key: `attachment:${file}` }, { url: `/api/cards/${card}`, key: `card:${card}` })
    expect((await s.client.get(`/api/attachments/${file}`)).body).toBe('hola')
  })

  it('A12 a file of a card, then its board', async () => {
    const s = await space('A12')
    const card = (await s.client.post(`/api/columns/${s.columns[0]!.id}/cards`, { title: 'Tarea' })).body.id
    const file = (await s.client.upload(`/api/cards/${card}/attachments`, 'hola', { name: 'nota.txt', type: 'text/plain' })).body.id
    await nested(s, { url: `/api/attachments/${file}`, key: `attachment:${file}` }, { url: `/api/boards/${s.boardId}`, key: `board:${s.boardId}` })
    expect((await s.client.get(`/api/cards/${card}`)).body.attachmentList.map((a: { id: string }) => a.id)).toEqual([file])
  })

  it('A13 a file of a page, then the page', async () => {
    const s = await space('A13')
    const page = (await s.client.post(`/api/projects/${s.projectId}/pages`, { title: 'Página' })).body.id
    const file = (await s.client.upload(`/api/pages/${page}/attachments`, 'hola', { name: 'nota.txt', type: 'text/plain' })).body.id
    await nested(s, { url: `/api/attachments/${file}`, key: `attachment:${file}` }, { url: `/api/pages/${page}`, key: `page:${page}` })
    expect((await s.client.get(`/api/attachments/${file}`)).body).toBe('hola')
  })

  it('A14 a page, then its project', async () => {
    const s = await space('A14')
    const page = (await s.client.post(`/api/projects/${s.projectId}/pages`, { title: 'Página' })).body.id
    await nested(s, { url: `/api/pages/${page}`, key: `page:${page}` }, { url: `/api/projects/${s.projectId}`, key: `project:${s.projectId}` })
    expect((await s.client.get(`/api/pages/${page}`)).body.projectId).toBe(s.projectId)
  })

  it('A15 a subpage, then its parent: back under it', async () => {
    const s = await space('A15')
    const mother = (await s.client.post(`/api/projects/${s.projectId}/pages`, { title: 'Madre' })).body.id
    const child = (await s.client.post(`/api/projects/${s.projectId}/pages`, { title: 'Hija', parentId: mother })).body.id
    await nested(s, { url: `/api/pages/${child}`, key: `page:${child}` }, { url: `/api/pages/${mother}`, key: `page:${mother}` })
    expect((await s.client.get(`/api/pages/${child}`)).body.parentId).toBe(mother)
    expect(await top(s)).toEqual([])
  })

  async function linked(s: Awaited<ReturnType<typeof space>>) {
    const card = (await s.client.post(`/api/columns/${s.columns[0]!.id}/cards`, { title: 'Tarea' })).body.id as string
    const page = (await s.client.post(`/api/projects/${s.projectId}/pages`, { title: 'Documento' })).body.id as string
    await s.client.post(`/api/cards/${card}/pages`, { pageId: page })
    return { card, page }
  }
  const pagesOf = async (s: Ctx, card: string) => (await s.client.get(`/api/cards/${card}`)).body.pages.map((p: { id: string }) => p.id)

  it('A16 a link between a card and a page taken off, then the card', async () => {
    const s = await space('A16')
    const { card, page } = await linked(s)
    await nested(s, { url: `/api/cards/${card}/pages/${page}`, key: `link:${card}:${page}` }, { url: `/api/cards/${card}`, key: `card:${card}` })
    expect(await pagesOf(s, card)).toEqual([page])
  })

  it('A17 a link taken off, then the page: it says the page is in the trash, and can bring it too', async () => {
    const s = await space('A17')
    const { card, page } = await linked(s)
    const linkTrash = await del(s.client, `/api/cards/${card}/pages/${page}`)
    await del(s.client, `/api/pages/${page}`)
    const early = await s.client.post(`/api/trash/${linkTrash}/restore`)
    expect(early.body.error).toMatchObject({ code: 'restore_place_in_trash', details: { title: 'Documento', key: `page:${page}` } })
    const asked = await plan(s, { key: `link:${card}:${page}` })
    expect(asked.relations).toEqual([expect.objectContaining({ kind: 'page', title: 'Documento', key: `page:${page}`, state: 'trash', canInclude: true, included: false })])
    expect((await plan(s, { key: `link:${card}:${page}`, include: [`page:${page}`] })).relations[0]).toMatchObject({ included: true })
    expect((await restore(s, { key: `link:${card}:${page}`, include: [`page:${page}`] })).status).toBe(200)
    expect(await pagesOf(s, card)).toEqual([page])
    expect(await top(s)).toEqual([])
  })
})

describe('B. deleting a container for good deletes what was inside it too, deleted before or not', () => {
  async function gone(s: Ctx, item: { url: string; key: string }, container: { url: string; key: string }, counted: Record<string, number>) {
    const itemTrash = await del(s.client, item.url)
    await del(s.client, container.url)
    const [held] = await top(s)
    expect(held).toMatchObject({ key: container.key, earlierContents: counted })
    expect((await purge(s, container.key)).status).toBe(204)
    expect(await top(s)).toEqual([])
    expect((await s.client.post(`/api/trash/${itemTrash}/restore`)).status).toBe(404)
  }

  it('B1 a column, then its board', async () => {
    const s = await space('B1')
    await gone(s, { url: `/api/columns/${s.columns[0]!.id}`, key: `column:${s.columns[0]!.id}` }, { url: `/api/boards/${s.boardId}`, key: `board:${s.boardId}` }, { columns: 1 })
  })

  it('B2 a card, then its board', async () => {
    const s = await space('B2')
    const card = (await s.client.post(`/api/columns/${s.columns[0]!.id}/cards`, { title: 'Tarea' })).body.id
    await gone(s, { url: `/api/cards/${card}`, key: `card:${card}` }, { url: `/api/boards/${s.boardId}`, key: `board:${s.boardId}` }, { cards: 1 })
  })

  it('B3 a page, then its project', async () => {
    const s = await space('B3')
    const page = (await s.client.post(`/api/projects/${s.projectId}/pages`, { title: 'Página' })).body.id
    await gone(s, { url: `/api/pages/${page}`, key: `page:${page}` }, { url: `/api/projects/${s.projectId}`, key: `project:${s.projectId}` }, { pages: 1 })
  })

  it('B4 a checklist, then its card, with the history of both', async () => {
    const s = await space('B4')
    const card = (await s.client.post(`/api/columns/${s.columns[0]!.id}/cards`, { title: 'Tarea' })).body.id
    const list = (await s.client.post(`/api/cards/${card}/checklists`, { title: 'Pasos' })).body.id
    await gone(s, { url: `/api/checklists/${list}`, key: `checklist:${list}` }, { url: `/api/cards/${card}`, key: `card:${card}` }, { checklists: 1 })
    expect(h.db.select().from(history).where(eq(history.entityId, card)).all()).toEqual([])
    expect(h.db.select().from(history).where(eq(history.subjectId, list)).all()).toEqual([])
  })

  it('B5 a file, then its page: the file goes from the disk too', async () => {
    const s = await space('B5')
    const page = (await s.client.post(`/api/projects/${s.projectId}/pages`, { title: 'Página' })).body.id
    const file = (await s.client.upload(`/api/pages/${page}/attachments`, 'hola', { name: 'nota.txt', type: 'text/plain' })).body.id
    const key = h.db.select({ key: attachments.storageKey }).from(attachments).where(eq(attachments.id, file)).get()!.key
    await gone(s, { url: `/api/attachments/${file}`, key: `attachment:${file}` }, { url: `/api/pages/${page}`, key: `page:${page}` }, { attachments: 1 })
    expect(existsSync(path.join(h.env.dataDir, 'uploads', key))).toBe(false)
  })
})

describe('C. relations come back with both ends, wait for the one in the trash, or say why not', () => {
  const hasLabel = async (s: Ctx, card: string, label: string) => ((await s.client.get(`/api/cards/${card}`)).body.labelIds as string[]).includes(label)
  const hasPage = async (s: Ctx, card: string, page: string) => ((await s.client.get(`/api/cards/${card}`)).body.pages as { id: string }[]).some((p) => p.id === page)

  async function labelled(s: Awaited<ReturnType<typeof space>>) {
    const label = (await s.client.post(`/api/boards/${s.boardId}/labels`, { name: 'Urgente', color: 'tomato' })).body.id as string
    const card = (await s.client.post(`/api/columns/${s.columns[0]!.id}/cards`, { title: 'Tarea', labelIds: [label] })).body.id as string
    return { label, card }
  }

  it('C1 card, then its label: the label waits, and the card gets it back with it', async () => {
    const s = await space('C1')
    const { label, card } = await labelled(s)
    const cardTrash = await del(s.client, `/api/cards/${card}`)
    const labelTrash = await del(s.client, `/api/labels/${label}`)
    expect((await plan(s, { key: `card:${card}` })).relations).toEqual([
      expect.objectContaining({ kind: 'label', title: 'Urgente', key: `label:${label}`, state: 'trash', count: 1, first: 'Tarea', canInclude: true }),
    ])
    expect((await s.client.post(`/api/trash/${cardTrash}/restore`)).status).toBe(200)
    expect(await hasLabel(s, card, label)).toBe(false)
    expect((await s.client.post(`/api/trash/${labelTrash}/restore`)).status).toBe(200)
    expect(await hasLabel(s, card, label)).toBe(true)
  })

  it('C1b the same, bringing the label along', async () => {
    const s = await space('C1b')
    const { label, card } = await labelled(s)
    await del(s.client, `/api/cards/${card}`)
    await del(s.client, `/api/labels/${label}`)
    expect((await restore(s, { key: `card:${card}`, include: [`label:${label}`] })).status).toBe(200)
    expect(await hasLabel(s, card, label)).toBe(true)
    expect(await top(s)).toEqual([])
  })

  it('C2 label, then the card', async () => {
    const s = await space('C2')
    const { label, card } = await labelled(s)
    const labelTrash = await del(s.client, `/api/labels/${label}`)
    const cardTrash = await del(s.client, `/api/cards/${card}`)
    expect((await s.client.post(`/api/trash/${cardTrash}/restore`)).status).toBe(200)
    expect((await s.client.post(`/api/trash/${labelTrash}/restore`)).status).toBe(200)
    expect(await hasLabel(s, card, label)).toBe(true)
  })

  async function linked(s: Awaited<ReturnType<typeof space>>) {
    const card = (await s.client.post(`/api/columns/${s.columns[0]!.id}/cards`, { title: 'Tarea' })).body.id as string
    const page = (await s.client.post(`/api/projects/${s.projectId}/pages`, { title: 'Documento' })).body.id as string
    await s.client.post(`/api/cards/${card}/pages`, { pageId: page })
    return { card, page }
  }

  it('C3 card linked to a page, then the page', async () => {
    const s = await space('C3')
    const { card, page } = await linked(s)
    const cardTrash = await del(s.client, `/api/cards/${card}`)
    const pageTrash = await del(s.client, `/api/pages/${page}`)
    expect((await s.client.post(`/api/trash/${cardTrash}/restore`)).status).toBe(200)
    expect((await s.client.post(`/api/trash/${pageTrash}/restore`)).status).toBe(200)
    expect(await hasPage(s, card, page)).toBe(true)
  })

  it('C4 page, then the card', async () => {
    const s = await space('C4')
    const { card, page } = await linked(s)
    const pageTrash = await del(s.client, `/api/pages/${page}`)
    const cardTrash = await del(s.client, `/api/cards/${card}`)
    expect((await s.client.post(`/api/trash/${cardTrash}/restore`)).status).toBe(200)
    expect((await s.client.post(`/api/trash/${pageTrash}/restore`)).status).toBe(200)
    expect(await hasPage(s, card, page)).toBe(true)
  })

  it('C5 a page mentioning a card: the mention links them again', async () => {
    const s = await space('C5')
    const card = (await s.client.post(`/api/columns/${s.columns[0]!.id}/cards`, { title: 'Mencionada' })).body.id as string
    const page = (await s.client.post(`/api/projects/${s.projectId}/pages`, { title: 'Doc', content: `Ver [Mencionada](/card/${card})` })).body.id as string
    const cardTrash = await del(s.client, `/api/cards/${card}`)
    expect((await s.client.post(`/api/trash/${cardTrash}/restore`)).status).toBe(200)
    expect(await hasPage(s, card, page)).toBe(true)
  })

  it('C6 a label, its card moved to another board, then the label: it says it does not apply', async () => {
    const s = await space('C6')
    const { label, card } = await labelled(s)
    const other = (await s.client.post(`/api/projects/${s.projectId}/boards`, { name: 'Dos' })).body.id as string
    const otherColumn = (await s.client.get(`/api/boards/${other}`)).body.columns[0].id as string
    await del(s.client, `/api/labels/${label}`)
    expect((await s.client.post(`/api/cards/${card}/move`, { columnId: otherColumn, index: 0 })).status).toBe(200)
    const asked = await plan(s, { key: `label:${label}` })
    expect(asked.relations).toEqual([expect.objectContaining({ kind: 'label', title: 'Urgente', state: 'other_board', count: 1, first: 'Tarea' })])
    expect((await restore(s, { key: `label:${label}` })).status).toBe(200)
    expect((await s.client.get(`/api/boards/${s.boardId}`)).body.labels.map((l: { id: string }) => l.id)).toEqual([label])
    expect(await hasLabel(s, card, label)).toBe(false)
  })
})

describe('restoring from the trash', () => {
  it('in the owner’s case brings back the columns where they were, with their board and project, and nothing anywhere else', async () => {
    const s = await space('Propietario')
    const xxx = (await s.client.post(`/api/workspaces/${s.workspaceId}/projects`, { name: 'xxx' })).body.id as string
    const board = (await s.client.post(`/api/projects/${xxx}/boards`, { name: 'Tareas' })).body.id as string
    const [todo, doing, done] = (await s.client.get(`/api/boards/${board}`)).body.columns as { id: string; name: string }[]
    const card = (await s.client.post(`/api/columns/${doing!.id}/cards`, { title: 'En marcha' })).body.id as string
    await del(s.client, `/api/columns/${doing!.id}`)
    await del(s.client, `/api/columns/${done!.id}`)
    await del(s.client, `/api/boards/${board}`)
    await del(s.client, `/api/projects/${xxx}`)
    expect((await top(s)).map((n) => n.key)).toEqual([`project:${xxx}`])
    const tree = await treeOf(s, `project:${xxx}`)
    expect(tree.below.map((n) => [n.title, n.earlier])).toEqual([
      ['Tareas', true],
      ['To do', false],
      ['In progress', true],
      ['En marcha', false],
      ['Done', true],
    ])

    const asked = await plan(s, { key: `column:${doing!.id}` })
    expect(asked.where).toMatchObject({ to: 'recreate', location: 'xxx › Tareas', path: [{ title: 'xxx' }, { title: 'Tareas' }] })
    expect((await restore(s, { key: `column:${doing!.id}` })).body).toMatchObject({ location: 'xxx › Tareas', restored: 3 })
    // Where it was, with its card: never in another project's board.
    expect((await s.client.get(`/api/boards/${board}`)).body.columns.map((c: { id: string }) => c.id)).toEqual([doing!.id])
    expect((await s.client.get(`/api/cards/${card}`)).body.column.id).toBe(doing!.id)
    // What was not asked for stays in the trash, now each straight back to its place.
    const left = await top(s)
    expect(left.map((n) => `${n.key} ${n.place}`).sort()).toEqual([`column:${done!.id} original`, `column:${todo!.id} original`].sort())
    expect((await plan(s, { key: `column:${done!.id}` })).where).toMatchObject({ to: 'original', location: 'xxx › Tareas' })
    expect((await restore(s, { key: `column:${done!.id}` })).status).toBe(200)
    expect((await s.client.get(`/api/boards/${board}`)).body.columns.map((c: { id: string }) => c.id)).toEqual([doing!.id, done!.id])
  })

  it('leaves out what is left out, with all below it', async () => {
    const s = await space('Descartar')
    const card = (await s.client.post(`/api/columns/${s.columns[0]!.id}/cards`, { title: 'Fuera' })).body.id as string
    await s.client.post(`/api/cards/${card}/checklists`, { title: 'Pasos' })
    await del(s.client, `/api/boards/${s.boardId}`)
    const asked = await plan(s, { key: `board:${s.boardId}`, exclude: [`column:${s.columns[0]!.id}`] })
    expect(asked.nodes.filter((n) => !n.included).map((n) => n.kind)).toEqual(['column', 'card', 'checklist'])
    expect((await restore(s, { key: `board:${s.boardId}`, exclude: [`column:${s.columns[0]!.id}`] })).body).toMatchObject({ left: 1 })
    expect((await s.client.get(`/api/boards/${s.boardId}`)).body.columns.map((c: { id: string }) => c.id)).toEqual(s.columns.slice(1).map((c) => c.id))
    expect(await top(s)).toMatchObject([{ key: `column:${s.columns[0]!.id}`, place: 'original', contents: { cards: 1, checklists: 1 } }])
  })

  it('asks about names already used where things go back, renames or keeps them, also inside', async () => {
    const s = await space('Nombres')
    const xxx = (await s.client.post(`/api/workspaces/${s.workspaceId}/projects`, { name: 'xxx' })).body.id as string
    const board = (await s.client.post(`/api/projects/${xxx}/boards`, { name: 'Tareas' })).body.id as string
    const card = (await s.client.post(`/api/columns/${s.columns[0]!.id}/cards`, { title: 'Repetida' })).body.id as string
    await del(s.client, `/api/projects/${xxx}`)
    await del(s.client, `/api/cards/${card}`)
    // Made again meanwhile, by the same names: duplicates are allowed when making things.
    expect((await s.client.post(`/api/workspaces/${s.workspaceId}/projects`, { name: 'XXX' })).status).toBe(201)
    await s.client.post(`/api/columns/${s.columns[0]!.id}/cards`, { title: 'Repetida' })

    const asked = await plan(s, { key: `project:${xxx}` })
    expect(asked).toMatchObject({ ready: false, missing: ['names'], conflicts: [{ key: `project:${xxx}`, original: 'xxx', name: 'xxx', where: '', taken: true, kept: false }] })
    const renamed = await plan(s, { key: `project:${xxx}`, names: { [`project:${xxx}`]: 'xxx (restaurado)' } })
    expect(renamed).toMatchObject({ ready: true, conflicts: [{ name: 'xxx (restaurado)', taken: false }] })
    // A name still taken is asked again.
    expect((await plan(s, { key: `project:${xxx}`, names: { [`project:${xxx}`]: 'Lanzamiento' } })).missing).toEqual(['names'])
    expect((await restore(s, { key: `project:${xxx}`, names: { [`project:${xxx}`]: 'xxx (restaurado)' } })).status).toBe(200)
    const projects = (await s.client.get(`/api/workspaces/${s.workspaceId}/overview`)).body.projects as { id: string; name: string }[]
    expect(projects.find((p) => p.id === xxx)?.name).toBe('xxx (restaurado)')
    expect((await s.client.get(`/api/boards/${board}`)).body.name).toBe('Tareas')

    // Kept on purpose.
    expect((await plan(s, { key: `card:${card}` })).conflicts).toMatchObject([{ where: 'To do', taken: true }])
    expect((await restore(s, { key: `card:${card}`, keepNames: [`card:${card}`] })).status).toBe(200)
    expect((await s.client.get(`/api/cards/${card}`)).body.title).toBe('Repetida')

    // Inside: a column deleted before, whose name another one of its board took meanwhile.
    const first = (await s.client.post(`/api/boards/${board}/columns`, { name: 'Hecho' })).body.id as string
    await del(s.client, `/api/columns/${first}`)
    const second = (await s.client.post(`/api/boards/${board}/columns`, { name: 'Hecho' })).body.id as string
    await del(s.client, `/api/boards/${board}`)
    const inside = await plan(s, { key: `board:${board}` })
    expect(inside.conflicts.map((c) => [c.key, c.where])).toEqual([[`column:${first}`, 'Tareas']])
    expect((await restore(s, { key: `board:${board}`, names: { [`column:${first}`]: 'Hecho antes' } })).status).toBe(200)
    const columns = (await s.client.get(`/api/boards/${board}`)).body.columns as { id: string; name: string }[]
    expect(columns.filter((c) => c.id === first || c.id === second).map((c) => c.name).sort()).toEqual(['Hecho', 'Hecho antes'])
  })

  it('brings back what was restored with its whole history, and forgets the history of what is deleted for good', async () => {
    const s = await space('Historial')
    const card = (await s.client.post(`/api/columns/${s.columns[0]!.id}/cards`, { title: 'Con pasado' })).body.id as string
    await s.client.patch(`/api/cards/${card}`, { title: 'Con pasado, revisada' })
    const before = ((await s.client.get(`/api/cards/${card}/history`)).body as HistoryEntryDTO[]).map((e) => e.id)
    await del(s.client, `/api/cards/${card}`)
    await del(s.client, `/api/boards/${s.boardId}`)
    expect((await restore(s, { key: `board:${s.boardId}` })).status).toBe(200)
    const after = (await s.client.get(`/api/cards/${card}/history`)).body as HistoryEntryDTO[]
    expect(after.map((e) => e.kind).slice(0, 2)).toEqual(['card.restored', 'card.deleted'])
    expect(after.map((e) => e.id)).toEqual(expect.arrayContaining(before))

    await del(s.client, `/api/cards/${card}`)
    await del(s.client, `/api/boards/${s.boardId}`)
    expect((await purge(s, `board:${s.boardId}`)).status).toBe(204)
    expect(h.db.select().from(history).where(eq(history.entityId, card)).all()).toEqual([])
  })

  it('says in the activity what is in the trash now, to open it there', async () => {
    const s = await space('Actividad')
    const card = (await s.client.post(`/api/columns/${s.columns[0]!.id}/cards`, { title: 'Anotada' })).body.id as string
    const activity = async () => ((await s.client.get(`/api/workspaces/${s.workspaceId}/activity`)).body as ActivityDTO[]).filter((a) => a.entityId === card)
    await del(s.client, `/api/columns/${s.columns[0]!.id}`)
    expect((await activity()).map((a) => [a.action, a.inTrash])).toEqual([['card.created', `card:${card}`]])
    expect((await restore(s, { key: `column:${s.columns[0]!.id}` })).status).toBe(200)
    expect((await activity()).every((a) => a.inTrash === undefined)).toBe(true)
    await del(s.client, `/api/cards/${card}`)
    expect((await purge(s, `card:${card}`)).status).toBe(204)
    expect((await activity()).every((a) => a.inTrash === undefined)).toBe(true)
  })

  it('puts back and deletes for good big trees within the 100 parameters a query takes on Cloudflare', async () => {
    const s = await space('Grande')
    for (let i = 0; i < 130; i++) await s.client.post(`/api/columns/${s.columns[i % 3]!.id}/cards`, { title: `Tarjeta ${i}` })
    await del(s.client, `/api/projects/${s.projectId}`)
    const [project] = await top(s)
    expect(project!.contents).toMatchObject({ boards: 1, columns: 3, cards: 130 })
    expect((await restore(s, { key: `project:${s.projectId}` })).body).toMatchObject({ restored: 134 })
    expect((await s.client.get(`/api/boards/${s.boardId}`)).body.cards).toHaveLength(130)
    await del(s.client, `/api/projects/${s.projectId}`)
    expect((await purge(s, `project:${s.projectId}`)).status).toBe(204)
    expect(await top(s)).toEqual([])
  })

  it('shows what comes back from the rest of the trash, also a card brought by its label, and drops what no longer applies', async () => {
    const s = await space('Traídas')
    const label = (await s.client.post(`/api/boards/${s.boardId}/labels`, { name: 'Urgente', color: 'tomato' })).body.id as string
    const card = (await s.client.post(`/api/columns/${s.columns[0]!.id}/cards`, { title: 'Etiquetada', labelIds: [label] })).body.id as string
    await s.client.post(`/api/cards/${card}/checklists`, { title: 'Pasos' })
    await del(s.client, `/api/cards/${card}`)
    await del(s.client, `/api/labels/${label}`)
    const before = await plan(s, { key: `label:${label}` })
    expect(before.relations).toEqual([expect.objectContaining({ kind: 'card', key: `card:${card}`, state: 'trash', included: false, canInclude: true })])
    // Brought along, it is still listed, ticked: what comes back is what is shown.
    const after = await plan(s, { key: `label:${label}`, include: [`card:${card}`] })
    expect(after.relations).toEqual([expect.objectContaining({ kind: 'card', key: `card:${card}`, state: 'trash', included: true })])

    // A card whose label was brought along, left out afterwards: the label no longer applies.
    const column = s.columns[1]!.id
    const other = (await s.client.post(`/api/boards/${s.boardId}/labels`, { name: 'Lenta', color: 'jade' })).body.id as string
    const inColumn = (await s.client.post(`/api/columns/${column}/cards`, { title: 'En columna', labelIds: [other] })).body.id as string
    await del(s.client, `/api/labels/${other}`)
    await del(s.client, `/api/columns/${column}`)
    const asked = { key: `column:${column}`, include: [`label:${other}`], exclude: [`card:${inColumn}`] }
    expect((await plan(s, asked)).relations).toEqual([])
    expect((await restore(s, asked)).body.error.code).toBe('restore_changed')
    expect((await restore(s, { ...asked, include: [] })).status).toBe(200)
  })

  it('restores where it was shown going, or asks again when that changed meanwhile', async () => {
    const s = await space('Cambió')
    const card = (await s.client.post(`/api/columns/${s.columns[0]!.id}/cards`, { title: 'Sola' })).body.id as string
    await del(s.client, `/api/cards/${card}`)
    expect((await plan(s, { key: `card:${card}` })).where).toMatchObject({ place: 'original', to: 'original' })
    await del(s.client, `/api/columns/${s.columns[0]!.id}`)
    const refused = await restore(s, { key: `card:${card}`, to: { kind: 'original' } })
    expect(refused.body.error).toMatchObject({ code: 'restore_incomplete', details: { missing: ['place'], where: { place: 'trash' } } })
    expect(await treeOf(s, `column:${s.columns[0]!.id}`)).toMatchObject({ node: { kind: 'column' } })
  })

  it('compares file names as they are stored, and says a link waits for its page instead of claiming it is back', async () => {
    const s = await space('Archivos')
    const card = (await s.client.post(`/api/columns/${s.columns[0]!.id}/cards`, { title: 'Con archivos' })).body.id as string
    const file = (await s.client.upload(`/api/cards/${card}/attachments`, 'uno', { name: 'nota.txt', type: 'text/plain' })).body.id as string
    await s.client.upload(`/api/cards/${card}/attachments`, 'dos', { name: 'a_b.txt', type: 'text/plain' })
    await s.client.upload(`/api/cards/${card}/attachments`, 'tres', { name: 'nota.txt', type: 'text/plain' })
    await del(s.client, `/api/attachments/${file}`)
    const renamed = await plan(s, { key: `attachment:${file}`, names: { [`attachment:${file}`]: 'a/b.txt' } })
    expect(renamed.conflicts).toMatchObject([{ name: 'a_b.txt', taken: true }])

    const page = (await s.client.post(`/api/projects/${s.projectId}/pages`, { title: 'Destino' })).body.id as string
    await s.client.post(`/api/cards/${card}/pages`, { pageId: page })
    await del(s.client, `/api/cards/${card}/pages/${page}`)
    await del(s.client, `/api/pages/${page}`)
    const waits = await restore(s, { key: `link:${card}:${page}` })
    expect(waits.body).toMatchObject({ waitsFor: 'Destino' })
    const activity = (await s.client.get(`/api/workspaces/${s.workspaceId}/activity`)).body as ActivityDTO[]
    expect(activity.filter((a) => a.action === 'trash.restored')).toEqual([])
    expect((await s.client.post(`/api/workspaces/${s.workspaceId}/trash/restore`, { key: `page:${page}` })).status).toBe(200)
    expect(((await s.client.get(`/api/cards/${card}`)).body.pages as { id: string }[]).map((p) => p.id)).toEqual([page])
  })

  it('never leaves a board with more columns than it holds', async () => {
    const s = await space('Límite')
    const board = (await s.client.post(`/api/projects/${s.projectId}/boards`, { name: 'Lleno', columns: Array.from({ length: 20 }, (_, i) => `C${i + 1}`) })).body.id as string
    const columns = (await s.client.get(`/api/boards/${board}`)).body.columns as { id: string }[]
    const gone = columns[0]!.id
    const trashId = await del(s.client, `/api/columns/${gone}`)
    expect((await s.client.post(`/api/boards/${board}/columns`, { name: 'Nueva' })).status).toBe(201)

    // Undoing the deletion says there is no room; the trash says why, and offers another place.
    const undo = await s.client.post(`/api/trash/${trashId}/restore`)
    expect([undo.status, undo.body.error.code]).toEqual([409, 'too_many_columns'])
    const asked = await plan(s, { key: `column:${gone}` })
    expect(asked).toMatchObject({ ready: false, missing: ['columns'], limits: [{ board: 'Lleno', count: 21, max: 20 }] })
    expect((await restore(s, { key: `column:${gone}` })).body.error).toMatchObject({ code: 'restore_incomplete', details: { limits: [{ board: 'Lleno' }] } })
    expect((await s.client.get(`/api/boards/${board}`)).body.columns).toHaveLength(20)
    const elsewhere = await restore(s, { key: `column:${gone}`, to: { kind: 'other', parent: { kind: 'board', id: s.boardId } } })
    expect(elsewhere.status).toBe(200)
    expect((await s.client.get(`/api/boards/${s.boardId}`)).body.columns.map((c: { id: string }) => c.id)).toContain(gone)

    // A board coming back with a column deleted from it before, when it had made room again.
    const before = (await s.client.get(`/api/boards/${board}`)).body.columns as { id: string }[]
    await del(s.client, `/api/columns/${before[1]!.id}`)
    await s.client.post(`/api/boards/${board}/columns`, { name: 'Otra' })
    await del(s.client, `/api/boards/${board}`)
    expect(await plan(s, { key: `board:${board}` })).toMatchObject({ missing: ['columns'], limits: [{ board: 'Lleno', count: 21 }] })
    const leftOut = await restore(s, { key: `board:${board}`, exclude: [`column:${before[1]!.id}`] })
    expect(leftOut.status).toBe(200)
    expect((await s.client.get(`/api/boards/${board}`)).body.columns).toHaveLength(20)
  })

  it('belongs to people, in its workspace', async () => {
    const s = await space('Dueña del árbol')
    const card = (await s.client.post(`/api/columns/${s.columns[0]!.id}/cards`, { title: 'Mía' })).body.id as string
    await del(s.client, `/api/cards/${card}`)
    const { client: stranger } = await signUp(h, 'Ajena del árbol')
    expect((await stranger.get(`/api/workspaces/${s.workspaceId}/trash/card:${card}`)).status).toBe(404)
    expect((await stranger.post(`/api/workspaces/${s.workspaceId}/trash/restore`, { key: `card:${card}` })).status).toBe(404)
    expect((await stranger.del(`/api/workspaces/${s.workspaceId}/trash/card:${card}`)).status).toBe(404)
    expect((await s.client.get(`/api/workspaces/${s.workspaceId}/trash/nonsense`)).status).toBe(400)
    // Asking for something not in the trash says so, without an error: it is how the app finds out.
    const notThere = await s.client.get(`/api/workspaces/${s.workspaceId}/trash/card:${s.boardId}`)
    expect([notThere.status, notThere.body]).toEqual([200, null])
    expect((await s.client.post(`/api/workspaces/${s.workspaceId}/trash/restore`, { key: 'card:nope' })).status).toBe(400)
    expect(await top(s)).toHaveLength(1)
  })
})
