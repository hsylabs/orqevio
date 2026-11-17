import type { HistoryEntryDTO, Scope, UndoResultDTO } from '@orqevio/shared'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { history } from '../src/db/schema'
import { Client, type Harness, createHarness, seedBoard, signUp } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => h.close())

const historyOf = async (client: Client, type: 'pages' | 'cards', id: string) => (await client.get(`/api/${type}/${id}/history`)).body as HistoryEntryDTO[]
const latest = async (client: Client, type: 'pages' | 'cards', id: string, kind: string) => (await historyOf(client, type, id)).find((e) => e.kind === kind)!

async function agent(client: Client, workspaceId: string, scopes: Scope[] = ['tasks:read', 'tasks:write', 'docs:read', 'docs:write'], name = 'Asistente') {
  const res = await client.post('/api/tokens', { name, workspaceId, scopes, expiresInDays: 30 })
  expect(res.status).toBe(201)
  return new Client(h, res.body.token)
}

async function undo(client: Client, body: Record<string, unknown>) {
  const res = await client.post('/api/history/undo', body)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as UndoResultDTO
}

describe('undo', () => {
  it('takes back each change to a card, and records undoing it as a change of its own', async () => {
    const { client, workspaceId } = await signUp(h)
    const { projectId, boardId, columns } = await seedBoard(client, workspaceId)
    const bot = await agent(client, workspaceId)
    const urgent = (await client.post(`/api/boards/${boardId}/labels`, { name: 'Urgente', color: 'tomato' })).body.id as string
    const page = (await client.post(`/api/projects/${projectId}/pages`, { title: 'Informe' })).body.id as string
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Contrato', description: 'Revisar' })).body.id as string
    const list = (await client.post(`/api/cards/${card}/checklists`, { title: 'Pasos' })).body.id as string
    const item = (await client.post(`/api/checklists/${list}/items`, { text: 'Leer' })).body.id as string

    // What the agent does, one change at a time, and undoing each.
    const steps: Array<[() => Promise<unknown>, string, () => Promise<void>]> = [
      [() => bot.patch(`/api/cards/${card}`, { title: 'Contrato firmado' }), 'card.title', async () => expect((await client.get(`/api/cards/${card}`)).body.title).toBe('Contrato')],
      [() => bot.patch(`/api/cards/${card}`, { description: 'Revisar y firmar' }), 'card.description', async () => expect((await client.get(`/api/cards/${card}`)).body.description).toBe('Revisar')],
      [() => bot.patch(`/api/cards/${card}`, { dueAt: '2026-12-01T12:00:00.000Z' }), 'card.due', async () => expect((await client.get(`/api/cards/${card}`)).body.dueAt).toBeNull()],
      [() => bot.patch(`/api/cards/${card}`, { labelIds: [urgent] }), 'card.labels', async () => expect((await client.get(`/api/cards/${card}`)).body.labelIds).toEqual([])],
      [() => bot.post(`/api/cards/${card}/move`, { columnId: columns[1]!.id, index: 0 }), 'card.moved', async () => expect((await client.get(`/api/cards/${card}`)).body.columnId).toBe(columns[0]!.id)],
      [() => bot.post(`/api/cards/${card}/archive`), 'card.archived', async () => expect((await client.get(`/api/cards/${card}`)).body.archivedAt).toBeNull()],
      [() => bot.patch(`/api/checklists/${list}`, { title: 'Pasos a seguir' }), 'checklist.title', async () => expect((await client.get(`/api/cards/${card}`)).body.checklists[0].title).toBe('Pasos')],
      [() => bot.patch(`/api/checklist-items/${item}`, { text: 'Leerlo' }), 'item.text', async () => expect((await client.get(`/api/cards/${card}`)).body.checklists[0].items[0].text).toBe('Leer')],
      [() => bot.patch(`/api/checklist-items/${item}`, { done: true }), 'item.done', async () => expect((await client.get(`/api/cards/${card}`)).body.checklists[0].items[0].done).toBe(false)],
      [() => bot.post(`/api/cards/${card}/pages`, { pageId: page }), 'card.linked', async () => expect((await client.get(`/api/cards/${card}`)).body.pages).toEqual([])],
      [() => bot.post(`/api/checklists/${list}/items`, { text: 'Firmar' }), 'item.created', async () => expect((await client.get(`/api/cards/${card}`)).body.checklists[0].items).toHaveLength(1)],
      [() => bot.post(`/api/cards/${card}/checklists`, { title: 'Extra' }), 'checklist.created', async () => expect((await client.get(`/api/cards/${card}`)).body.checklists).toHaveLength(1)],
      // What only people delete comes back from the trash.
      [() => client.del(`/api/checklist-items/${item}`), 'item.deleted', async () => expect((await client.get(`/api/cards/${card}`)).body.checklists[0].items).toHaveLength(1)],
      [() => client.upload(`/api/cards/${card}/attachments`, 'pdf', { name: 'contrato.pdf', type: 'application/pdf' }), 'attachment.created', async () => expect((await client.get(`/api/cards/${card}`)).body.attachmentList).toEqual([])],
    ]
    for (const [change, kind, check] of steps) {
      await change()
      const entry = await latest(client, 'cards', card, kind)
      const result = await undo(client, { ids: [entry.id] })
      expect([result.applied, result.undone, result.plan[0]!.status], kind).toEqual([true, 1, 'ready'])
      await check()
      // Undoing it again finds nothing to do.
      expect((await undo(client, { ids: [entry.id] })).plan[0]!.status, kind).toBe('unchanged')
    }

    // Each undo is in the history, saying which change it took back; and can be undone too.
    const entries = await historyOf(client, 'cards', card)
    const undoTitle = entries.find((e) => e.kind === 'card.title' && e.meta.undoOf)!
    expect(undoTitle).toMatchObject({ before: 'Contrato firmado', after: 'Contrato', actor: { kind: 'user' } })
    await undo(client, { ids: [undoTitle.id] })
    expect((await client.get(`/api/cards/${card}`)).body.title).toBe('Contrato firmado')
  })

  it('takes back changes to a page: its text, name, icon and place, and making or deleting it', async () => {
    const { client, workspaceId } = await signUp(h, 'Páginas')
    const { projectId } = await seedBoard(client, workspaceId)
    const bot = await agent(client, workspaceId)
    const parent = (await client.post(`/api/projects/${projectId}/pages`, { title: 'Guías' })).body.id as string
    const page = (await client.post(`/api/projects/${projectId}/pages`, { title: 'Estilo', content: 'Frases cortas.' })).body.id as string
    const version = (await client.get(`/api/pages/${page}`)).body.version as number
    await bot.patch(`/api/pages/${page}`, { content: 'Frases cortas.\n\nSin tecnicismos.', baseVersion: version })
    await bot.patch(`/api/pages/${page}`, { title: 'Estilo y tono', icon: '✍️' })
    await bot.post(`/api/pages/${page}/move`, { parentId: parent, index: 0 })

    for (const kind of ['page.moved', 'page.icon', 'page.title', 'page.content']) await undo(client, { ids: [(await latest(client, 'pages', page, kind)).id] })
    expect((await client.get(`/api/pages/${page}`)).body).toMatchObject({ title: 'Estilo', icon: null, content: 'Frases cortas.', parentId: null })

    // A page the agent made goes to the trash; a page someone deleted comes back from it.
    const made = (await bot.post(`/api/projects/${projectId}/pages`, { title: 'Borrador del agente' })).body.id as string
    await undo(client, { ids: [(await latest(client, 'pages', made, 'page.created')).id] })
    expect((await client.get(`/api/pages/${made}`)).status).toBe(404)
    await client.del(`/api/pages/${parent}`)
    const deleted = h.db.select({ id: history.id }).from(history).where(and(eq(history.entityId, parent), eq(history.kind, 'page.deleted'))).get()!
    await undo(client, { ids: [deleted.id] })
    expect((await client.get(`/api/pages/${parent}`)).status).toBe(200)
  })

  it('asks first when someone changed the same thing since, then skips it or undoes it anyway', async () => {
    const { client, workspaceId, user } = await signUp(h, 'Conflictos')
    const { columns } = await seedBoard(client, workspaceId)
    const bot = await agent(client, workspaceId)
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'A' })).body.id as string
    await bot.patch(`/api/cards/${card}`, { title: 'B' })
    const byAgent = await latest(client, 'cards', card, 'card.title')
    await client.patch(`/api/cards/${card}`, { title: 'C' })

    const asked = await undo(client, { ids: [byAgent.id] })
    expect(asked).toMatchObject({ applied: false, undone: 0 })
    expect(asked.plan[0]).toMatchObject({ status: 'conflict', current: 'C', changedBy: { kind: 'user', id: user.id }, entityTitle: 'C' })
    expect((await client.get(`/api/cards/${card}`)).body.title).toBe('C')

    expect(await undo(client, { ids: [byAgent.id], conflicts: 'skip' })).toMatchObject({ applied: true, undone: 0, skipped: 1 })
    expect((await client.get(`/api/cards/${card}`)).body.title).toBe('C')
    expect(await undo(client, { ids: [byAgent.id], conflicts: 'force' })).toMatchObject({ applied: true, undone: 1, skipped: 0 })
    expect((await client.get(`/api/cards/${card}`)).body.title).toBe('A')

    // A card the agent made and someone worked on since asks too; its own later changes don't count.
    const made = (await bot.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Del agente', description: 'Hecha por el agente' })).body.id as string
    await bot.patch(`/api/cards/${made}`, { title: 'Del agente, revisada' })
    const creation = await latest(client, 'cards', made, 'card.created')
    expect((await undo(client, { ids: [creation.id] })).plan[0]!.status).toBe('ready')
    await client.post(`/api/trash/${(await client.get(`/api/workspaces/${workspaceId}/trash`)).body[0].id}/restore`)
    await client.patch(`/api/cards/${made}`, { description: 'Con notas mías' })
    expect((await undo(client, { ids: [creation.id] })).plan[0]).toMatchObject({ status: 'conflict', changedBy: { kind: 'user' } })
  })

  it('takes back everything an agent did from one change on, newest first, and nothing else', async () => {
    const { client, workspaceId } = await signUp(h, 'Lotes')
    const { projectId, columns } = await seedBoard(client, workspaceId)
    const bot = await agent(client, workspaceId)
    const other = await agent(client, workspaceId, undefined, 'Otro agente')
    const kept = (await bot.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'De antes' })).body.id as string
    const page = (await client.post(`/api/projects/${projectId}/pages`, { title: 'Plan', content: 'Uno' })).body.id as string

    // The reorganisation to undo.
    const card = (await bot.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Nueva' })).body.id as string
    const first = await latest(client, 'cards', card, 'card.created')
    await bot.patch(`/api/cards/${card}`, { title: 'Nueva v2' })
    await bot.patch(`/api/cards/${card}`, { title: 'Nueva v3' })
    await bot.post(`/api/cards/${kept}/move`, { columnId: columns[1]!.id, index: 0 })
    let version = (await client.get(`/api/pages/${page}`)).body.version as number
    version = (await bot.patch(`/api/pages/${page}`, { content: 'Uno\nDos', baseVersion: version })).body.version
    await bot.patch(`/api/pages/${page}`, { title: 'Plan v2' })
    // Meanwhile: a person edits the page's text, another agent renames the card.
    await client.patch(`/api/pages/${page}`, { content: 'Uno\nDos\nTres', baseVersion: version })
    await other.patch(`/api/cards/${kept}`, { title: 'De antes, renombrada' })

    // A dry run plans without undoing anything, conflicts or not.
    const planned = await undo(client, { since: first.id, dryRun: true, conflicts: 'force' })
    expect([planned.applied, planned.plan.length]).toEqual([false, 6])
    expect((await client.get(`/api/cards/${card}`)).body.title).toBe('Nueva v3')
    const asked = await undo(client, { since: first.id })
    expect(asked.applied).toBe(false)
    expect(asked.plan.map((p) => [p.kind, p.status])).toEqual([
      ['page.title', 'ready'],
      ['page.content', 'conflict'],
      ['card.moved', 'ready'],
      ['card.title', 'ready'],
      ['card.title', 'ready'],
      ['card.created', 'ready'],
    ])
    const done = await undo(client, { since: first.id, conflicts: 'skip' })
    expect(done).toMatchObject({ applied: true, undone: 5, skipped: 1, failed: 0 })
    expect((await client.get(`/api/cards/${card}`)).status).toBe(404)
    expect((await client.get(`/api/cards/${kept}`)).body).toMatchObject({ title: 'De antes, renombrada', columnId: columns[0]!.id })
    expect((await client.get(`/api/pages/${page}`)).body).toMatchObject({ title: 'Plan', content: 'Uno\nDos\nTres' })
  })

  it('puts back a version of a page or a description, as a new change', async () => {
    const { client, workspaceId } = await signUp(h, 'Versiones')
    const { projectId, columns } = await seedBoard(client, workspaceId)
    const bot = await agent(client, workspaceId)
    const page = (await client.post(`/api/projects/${projectId}/pages`, { title: 'Acta', content: 'v1' })).body.id as string
    let version = (await client.get(`/api/pages/${page}`)).body.version as number
    for (const content of ['v2', 'v3']) version = (await bot.patch(`/api/pages/${page}`, { content, baseVersion: version })).body.version
    const v2 = (await historyOf(client, 'pages', page)).filter((e) => e.kind === 'page.content')[1]!
    expect((await client.post(`/api/history/${v2.id}/restore`)).status).toBe(204)
    expect((await client.get(`/api/pages/${page}`)).body.content).toBe('v2')
    const restored = await latest(client, 'pages', page, 'page.content')
    expect(restored.meta.restoredFrom).toBe(v2.id)

    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Ficha', description: 'd1' })).body.id as string
    await bot.patch(`/api/cards/${card}`, { description: 'd2' })
    const d1 = (await historyOf(client, 'cards', card)).find((e) => e.kind === 'card.description' && e.actor.kind === 'user')!
    expect((await client.post(`/api/history/${d1.id}/restore`)).status).toBe(204)
    expect((await client.get(`/api/cards/${card}`)).body.description).toBe('d1')
    // Only texts have versions.
    const created = await latest(client, 'cards', card, 'card.created')
    expect((await client.post(`/api/history/${created.id}/restore`)).status).toBe(400)
  })

  it('is for people who can open the workspace', async () => {
    const { client, workspaceId } = await signUp(h, 'Permisos')
    const { columns } = await seedBoard(client, workspaceId)
    const bot = await agent(client, workspaceId)
    const card = (await bot.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Del agente', description: 'x' })).body.id as string
    const entry = await latest(client, 'cards', card, 'card.created')
    const text = await latest(client, 'cards', card, 'card.description')
    expect((await bot.post('/api/history/undo', { ids: [entry.id] })).status).toBe(403)
    expect((await bot.post(`/api/history/${text.id}/restore`)).status).toBe(403)
    const stranger = await signUp(h, 'Ajena')
    expect((await stranger.client.post('/api/history/undo', { ids: [entry.id] })).status).toBe(404)
    expect((await stranger.client.post(`/api/history/${text.id}/restore`)).status).toBe(404)
    expect((await client.post('/api/history/undo', { ids: [entry.id], since: entry.id })).status).toBe(400)
  })

  it('counts what others did under a page, or in a long checklist, as changed since', async () => {
    const { client, workspaceId } = await signUp(h, 'Debajo')
    const { projectId, columns } = await seedBoard(client, workspaceId)
    const bot = await agent(client, workspaceId)
    // A page the agent made, with a subpage someone else made under it.
    const parent = (await bot.post(`/api/projects/${projectId}/pages`, { title: 'Del agente' })).body.id as string
    await bot.post(`/api/projects/${projectId}/pages`, { title: 'Suya también', parentId: parent })
    const created = await latest(client, 'pages', parent, 'page.created')
    expect((await undo(client, { ids: [created.id], dryRun: true })).plan[0]!.status).toBe('ready')
    const child = (await client.post(`/api/projects/${projectId}/pages`, { title: 'Mía', parentId: parent })).body.id as string
    expect((await undo(client, { ids: [created.id] })).plan[0]).toMatchObject({ status: 'conflict', changedBy: { kind: 'user' } })
    expect(await undo(client, { ids: [created.id], conflicts: 'skip' })).toMatchObject({ undone: 0, skipped: 1 })
    expect((await client.get(`/api/pages/${child}`)).status).toBe(200)

    // A card someone linked to a page the agent made: deleting the page would take the link.
    const linkedTo = (await bot.post(`/api/projects/${projectId}/pages`, { title: 'Enlazada' })).body.id as string
    const sub = (await bot.post(`/api/projects/${projectId}/pages`, { title: 'Subpágina', parentId: linkedTo })).body.id as string
    const linkedCreated = await latest(client, 'pages', linkedTo, 'page.created')
    const someCard = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Con enlace' })).body.id as string
    await client.post(`/api/cards/${someCard}/pages`, { pageId: sub })
    expect((await undo(client, { ids: [linkedCreated.id] })).plan[0]).toMatchObject({ status: 'conflict', changedBy: { kind: 'user' } })

    // A checklist the agent made, with someone's change to its 95th item.
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Larga' })).body.id as string
    const list = (await bot.post(`/api/cards/${card}/checklists`, { title: 'Muchos pasos' })).body.id as string
    let last = ''
    for (let i = 1; i <= 95; i++) last = (await bot.post(`/api/checklists/${list}/items`, { text: `Paso ${i}` })).body.id
    // Past the first page of the history: looked up directly.
    const listCreated = h.db.select({ id: history.id }).from(history).where(and(eq(history.subjectId, list), eq(history.kind, 'checklist.created'))).get()!
    await client.patch(`/api/checklist-items/${last}`, { done: true })
    expect((await undo(client, { ids: [listCreated.id] })).plan[0]!.status).toBe('conflict')
  })

  it('keeps undoing or restoring a text a change of its own, apart from the edits after it', async () => {
    const { client, workspaceId } = await signUp(h, 'Aparte')
    const { columns } = await seedBoard(client, workspaceId)
    const bot = await agent(client, workspaceId)
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'A' })).body.id as string
    await bot.patch(`/api/cards/${card}`, { title: 'B' })
    await undo(client, { ids: [(await latest(client, 'cards', card, 'card.title')).id] })
    const undid = await latest(client, 'cards', card, 'card.title')
    expect(undid).toMatchObject({ before: 'B', after: 'A', meta: { undoOf: expect.any(String) } })
    // Editing it right after is a change of its own; editing it back to B doesn't erase the undo either.
    await client.patch(`/api/cards/${card}`, { title: 'C' })
    await client.patch(`/api/cards/${card}`, { title: 'B' })
    const titles = (await historyOf(client, 'cards', card)).filter((e) => e.kind === 'card.title')
    expect(titles.map((e) => [e.before, e.after])).toEqual([
      ['A', 'B'],
      ['B', 'A'],
      ['A', 'B'],
    ])
    expect(titles[1]!.id).toBe(undid.id)
  })

  it('counts a change made in the same millisecond as the one undone as made after it', async () => {
    const { client, workspaceId } = await signUp(h, 'Mismo instante')
    const { columns } = await seedBoard(client, workspaceId)
    const bot = await agent(client, workspaceId)
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 60_000)
      const card = (await bot.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Al instante' })).body.id as string
      await client.patch(`/api/cards/${card}`, { title: 'Al instante, revisada' })
      vi.useRealTimers()
      const created = await latest(client, 'cards', card, 'card.created')
      const edited = await latest(client, 'cards', card, 'card.title')
      expect(edited.updatedAt).toBe(created.updatedAt)
      expect((await undo(client, { ids: [created.id] })).plan[0]).toMatchObject({ status: 'conflict', changedBy: { kind: 'user' } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('takes several versions of a long text back to the first, comparing them where they are stored', async () => {
    const { client, workspaceId } = await signUp(h, 'Versiones largas')
    const { projectId } = await seedBoard(client, workspaceId)
    const bot = await agent(client, workspaceId)
    const long = (word: string) => `${word} `.repeat(20_000)
    const page = (await client.post(`/api/projects/${projectId}/pages`, { title: 'Larga', content: long('uno') })).body.id as string
    let version = (await client.get(`/api/pages/${page}`)).body.version as number
    for (const word of ['dos', 'tres', 'cuatro']) version = (await bot.patch(`/api/pages/${page}`, { content: long(word), baseVersion: version })).body.version
    const first = (await historyOf(client, 'pages', page)).filter((e) => e.kind === 'page.content' && e.actor.kind === 'agent').at(-1)!
    const planned = await undo(client, { since: first.id, dryRun: true })
    expect(planned.plan.map((p) => p.status)).toEqual(['ready', 'ready', 'ready'])
    expect(await undo(client, { since: first.id })).toMatchObject({ applied: true, undone: 3 })
    expect((await client.get(`/api/pages/${page}`)).body.content).toBe(long('uno'))
    // Someone's edit on top makes the newest a conflict, showing the start of the text as it is now.
    await bot.patch(`/api/pages/${page}`, { content: long('cinco'), baseVersion: (await client.get(`/api/pages/${page}`)).body.version })
    const fifth = (await historyOf(client, 'pages', page))[0]!
    await client.patch(`/api/pages/${page}`, { content: long('seis'), baseVersion: (await client.get(`/api/pages/${page}`)).body.version })
    const conflict = (await undo(client, { ids: [fifth.id] })).plan[0]!
    expect(conflict.status).toBe('conflict')
    expect(String(conflict.current)).toBe(long('seis').slice(0, 200))
  })

  it('says what can no longer be undone, and why', async () => {
    const { client, workspaceId } = await signUp(h, 'Imposible')
    const { columns } = await seedBoard(client, workspaceId)
    const bot = await agent(client, workspaceId)
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Mudanza' })).body.id as string
    await bot.post(`/api/cards/${card}/move`, { columnId: columns[1]!.id, index: 0 })
    const moved = await latest(client, 'cards', card, 'card.moved')
    await client.del(`/api/columns/${columns[0]!.id}`)
    expect((await undo(client, { ids: [moved.id] })).plan[0]).toMatchObject({ status: 'impossible', reason: 'place_gone' })

    const trashId = (await client.del(`/api/cards/${card}`)).body.trashId as string
    const deleted = h.db.select({ id: history.id }).from(history).where(and(eq(history.entityId, card), eq(history.kind, 'card.deleted'))).get()
    expect((await client.del(`/api/trash/${trashId}`)).status).toBe(204)
    // Deleting for good forgets the card's history: there is nothing left to undo.
    expect((await client.post('/api/history/undo', { ids: [deleted?.id ?? moved.id] })).status).toBe(404)
  })

  it('takes a card back to its old board with the labels it lost, and a file back where it was', async () => {
    const { client, workspaceId } = await signUp(h, 'Entre tableros')
    const { projectId, boardId, columns } = await seedBoard(client, workspaceId)
    const other = await seedBoard(client, workspaceId)
    const bot = await agent(client, workspaceId, ['tasks:read', 'tasks:write', 'docs:read', 'docs:write', 'organize'])
    const label = (await client.post(`/api/boards/${boardId}/labels`, { name: 'Bug', color: 'tomato' })).body.id as string
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Viaje', labelIds: [label] })).body.id as string
    expect((await bot.post(`/api/cards/${card}/move`, { columnId: other.columns[0]!.id, index: 0 })).status).toBe(200)
    const moved = await latest(client, 'cards', card, 'card.moved')
    expect(moved.meta).toMatchObject({ labels: ['Bug'] })
    expect((await undo(client, { ids: [moved.id] })).undone).toBe(1)
    const back = (await client.get(`/api/cards/${card}`)).body
    expect(back).toMatchObject({ board: { id: boardId }, column: { id: columns[0]!.id } })
    expect(back.labels.map((l: { id: string }) => l.id)).toEqual([label])

    // A file the agent moved, and a person moved again since: undoing asks first.
    const page = (await client.post(`/api/projects/${projectId}/pages`, { title: 'Destino' })).body.id as string
    const elsewhere = (await client.post(`/api/projects/${projectId}/pages`, { title: 'Otro sitio' })).body.id as string
    const file = (await client.upload(`/api/cards/${card}/attachments`, 'x', { name: 'x.txt', type: 'text/plain' })).body.id as string
    expect((await bot.post(`/api/attachments/${file}/move`, { pageId: page })).status).toBe(200)
    const fileMoved = await latest(client, 'pages', page, 'attachment.moved')
    expect((await client.post(`/api/attachments/${file}/move`, { pageId: elsewhere })).status).toBe(200)
    expect((await undo(client, { ids: [fileMoved.id] })).plan[0]).toMatchObject({ status: 'conflict', current: { cardId: null, pageId: elsewhere } })
    expect((await undo(client, { ids: [fileMoved.id], conflicts: 'force' })).undone).toBe(1)
    expect((await client.get(`/api/cards/${card}`)).body.attachmentList.map((a: { id: string }) => a.id)).toEqual([file])
    // Undoing both entries of one move moves it once.
    expect((await bot.post(`/api/attachments/${file}/move`, { pageId: page })).status).toBe(200)
    const both = [await latest(client, 'pages', page, 'attachment.moved'), await latest(client, 'cards', card, 'attachment.moved')]
    const result = await undo(client, { ids: both.map((e) => e.id) })
    expect(result).toMatchObject({ undone: 1, failed: 0 })
    expect((await client.get(`/api/cards/${card}`)).body.attachmentList).toHaveLength(1)
  })

  it('counts in the plan what undoing a newer deletion brings back from the trash', async () => {
    const { client, workspaceId } = await signUp(h, 'De vuelta')
    const { projectId, columns } = await seedBoard(client, workspaceId)
    const bot = await agent(client, workspaceId, ['tasks:read', 'tasks:write', 'docs:read', 'docs:write', 'organize'])
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Origen' })).body.id as string
    const page = (await client.post(`/api/projects/${projectId}/pages`, { title: 'Carpeta' })).body.id as string
    const file = (await bot.upload(`/api/cards/${card}/attachments`, 'x', { name: 'x.txt', type: 'text/plain' })).body.id as string
    await bot.patch(`/api/pages/${page}`, { title: 'Carpeta del agente' })
    await bot.post(`/api/attachments/${file}/move`, { pageId: page })
    await bot.del(`/api/pages/${page}`)
    const since = (await historyOf(client, 'cards', card)).findLast((e) => e.kind === 'attachment.created')!
    // The page and the file in it are in the trash now, but undoing the deletion first brings them back.
    const plan = (await undo(client, { since: since.id, dryRun: true })).plan
    expect(plan.map((p) => [p.kind, p.status, p.entityTitle])).toEqual([
      ['page.deleted', 'ready', 'Carpeta del agente'],
      ['attachment.moved', 'ready', 'Carpeta del agente'],
      ['attachment.moved', 'unchanged', 'Origen'],
      ['page.title', 'ready', 'Carpeta del agente'],
      ['attachment.created', 'ready', 'Origen'],
    ])
    const done = await undo(client, { since: since.id })
    expect(done).toMatchObject({ undone: 4, skipped: 0, failed: 0 })
    expect((await client.get(`/api/pages/${page}`)).body).toMatchObject({ title: 'Carpeta', attachments: [] })
    expect((await client.get(`/api/cards/${card}`)).body.attachmentList).toEqual([])
  })

  it('asks first when undoing would drop what someone did since in another place', async () => {
    const { client, workspaceId } = await signUp(h, 'Otro sitio')
    const { projectId, boardId, columns } = await seedBoard(client, workspaceId)
    const other = await seedBoard(client, workspaceId)
    const bot = await agent(client, workspaceId, ['tasks:read', 'tasks:write', 'docs:read', 'docs:write', 'organize'])
    const old = (await client.post(`/api/boards/${boardId}/labels`, { name: 'Antigua', color: 'tomato' })).body.id as string
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Viajera', labelIds: [old] })).body.id as string

    // Labels a person put on the card on its new board would go if the move were undone.
    await bot.post(`/api/cards/${card}/move`, { columnId: other.columns[0]!.id, index: 0 })
    const moved = await latest(client, 'cards', card, 'card.moved')
    const fresh = (await client.post(`/api/boards/${other.boardId}/labels`, { name: 'Nueva', color: 'jade' })).body.id as string
    await client.patch(`/api/cards/${card}`, { labelIds: [fresh] })
    const asked = await undo(client, { ids: [moved.id] })
    expect(asked).toMatchObject({ applied: false, plan: [{ status: 'conflict', changedBy: { kind: 'user', name: 'Otro sitio' } }] })
    expect((await client.get(`/api/cards/${card}`)).body.board.id).toBe(other.boardId)
    expect((await undo(client, { ids: [moved.id], conflicts: 'force' })).undone).toBe(1)
    const back = (await client.get(`/api/cards/${card}`)).body
    expect(back.board.id).toBe(boardId)
    expect(back.labels.map((l: { id: string }) => l.id)).toEqual([old])

    // A file the agent attached and moved, that a person then moved elsewhere: undoing the upload asks first.
    const page = (await client.post(`/api/projects/${projectId}/pages`, { title: 'Primero' })).body.id as string
    const later = (await client.post(`/api/projects/${projectId}/pages`, { title: 'Después' })).body.id as string
    const file = (await bot.upload(`/api/cards/${card}/attachments`, 'x', { name: 'x.txt', type: 'text/plain' })).body.id as string
    const uploaded = await latest(client, 'cards', card, 'attachment.created')
    await bot.post(`/api/attachments/${file}/move`, { pageId: page })
    await client.post(`/api/attachments/${file}/move`, { pageId: later })
    expect((await undo(client, { ids: [uploaded.id] })).plan[0]).toMatchObject({ status: 'conflict', changedBy: { kind: 'user', name: 'Otro sitio' } })
    expect((await client.get(`/api/pages/${later}`)).body.attachments.map((a: { id: string }) => a.id)).toEqual([file])
  })

  it('counts the subpages that undoing the deletion of their page brings back', async () => {
    const { client, workspaceId } = await signUp(h, 'Subpáginas')
    const { projectId } = await seedBoard(client, workspaceId)
    const bot = await agent(client, workspaceId, ['tasks:read', 'tasks:write', 'docs:read', 'docs:write', 'organize'])
    const top = (await client.post(`/api/projects/${projectId}/pages`, { title: 'Manual' })).body.id as string
    const sub = (await client.post(`/api/projects/${projectId}/pages`, { title: 'Instalar', parentId: top })).body.id as string
    await bot.patch(`/api/pages/${sub}`, { title: 'Instalar (revisado)' })
    await bot.del(`/api/pages/${top}`)
    // The subpage is in the trash with its page, out of reach of its history: read it in the database.
    const edit = h.db.select({ id: history.id }).from(history).where(and(eq(history.entityId, sub), eq(history.kind, 'page.title'))).get()!
    const plan = (await undo(client, { since: edit.id, dryRun: true })).plan
    expect(plan.map((p) => [p.kind, p.status])).toEqual([
      ['page.deleted', 'ready'],
      ['page.title', 'ready'],
    ])
    expect(await undo(client, { since: edit.id })).toMatchObject({ undone: 2, failed: 0 })
    expect((await client.get(`/api/pages/${sub}`)).body).toMatchObject({ title: 'Instalar', parentId: top })
  })

  it('checks what comes back from the trash against what was kept there, before undoing older changes', async () => {
    const { client, workspaceId } = await signUp(h, 'Guardado')
    const { projectId, boardId, columns } = await seedBoard(client, workspaceId)
    const bot = await agent(client, workspaceId, ['tasks:read', 'tasks:write', 'docs:read', 'docs:write', 'organize'])

    // A page the agent renamed and rewrote, that a person renamed and rewrote after, and the agent deleted.
    const page = (await client.post(`/api/projects/${projectId}/pages`, { title: 'A', content: 'Uno.' })).body.id as string
    await bot.patch(`/api/pages/${page}`, { title: 'B' })
    const renamed = await latest(client, 'pages', page, 'page.title')
    await bot.patch(`/api/pages/${page}`, { content: 'Dos.', baseVersion: (await client.get(`/api/pages/${page}`)).body.version })
    await client.patch(`/api/pages/${page}`, { title: 'C', content: 'Tres.', baseVersion: (await client.get(`/api/pages/${page}`)).body.version })
    await bot.del(`/api/pages/${page}`)
    const pagePlan = (await undo(client, { since: renamed.id, dryRun: true })).plan
    expect(pagePlan.map((p) => [p.kind, p.status, p.status === 'conflict' ? p.current : undefined])).toEqual([
      ['page.deleted', 'ready', undefined],
      ['page.content', 'conflict', 'Tres.'],
      ['page.title', 'conflict', 'C'],
    ])
    expect(pagePlan[2]).toMatchObject({ entityTitle: 'C', changedBy: { kind: 'user', name: 'Guardado' } })
    // Asked first, nothing is undone: the page stays in the trash.
    expect(await undo(client, { since: renamed.id })).toMatchObject({ applied: false, undone: 0 })
    expect((await client.get(`/api/pages/${page}`)).status).toBe(404)

    // The same for a card, its labels and the items of its checklists.
    const old = (await client.post(`/api/boards/${boardId}/labels`, { name: 'Vieja', color: 'tomato' })).body.id as string
    const fresh = (await client.post(`/api/boards/${boardId}/labels`, { name: 'Nueva', color: 'jade' })).body.id as string
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'A', description: 'Uno', labelIds: [old] })).body.id as string
    const list = (await client.post(`/api/cards/${card}/checklists`, { title: 'Pasos' })).body.id as string
    const item = (await client.post(`/api/checklists/${list}/items`, { text: 'Leer' })).body.id as string
    await bot.patch(`/api/cards/${card}`, { title: 'B' })
    const retitled = await latest(client, 'cards', card, 'card.title')
    await bot.patch(`/api/cards/${card}`, { description: 'Dos' })
    await bot.patch(`/api/checklist-items/${item}`, { text: 'Leerlo' })
    await bot.patch(`/api/checklist-items/${item}`, { done: true })
    await bot.patch(`/api/cards/${card}`, { labelIds: [fresh] })
    await client.patch(`/api/cards/${card}`, { title: 'C', description: 'Tres', labelIds: [] })
    await client.patch(`/api/checklist-items/${item}`, { text: 'Leerlo ya' })
    await bot.del(`/api/cards/${card}`)
    const cardPlan = (await undo(client, { since: retitled.id, dryRun: true })).plan
    expect(cardPlan.map((p) => [p.kind, p.status])).toEqual([
      ['card.deleted', 'ready'],
      ['card.labels', 'conflict'],
      ['item.done', 'ready'],
      ['item.text', 'conflict'],
      ['card.description', 'conflict'],
      ['card.title', 'conflict'],
    ])
    expect(await undo(client, { since: retitled.id })).toMatchObject({ applied: false, undone: 0 })
    expect((await client.get(`/api/cards/${card}`)).status).toBe(404)
    // Skipping what someone changed since undoes the rest, as planned.
    expect(await undo(client, { since: retitled.id, conflicts: 'skip' })).toMatchObject({ applied: true, undone: 2, skipped: 4, failed: 0 })
    const back = (await client.get(`/api/cards/${card}`)).body
    expect(back).toMatchObject({ title: 'C', description: 'Tres', labels: [] })
    expect(back.checklists[0].items[0]).toMatchObject({ text: 'Leerlo ya', done: false })
  })

  it('finds the old places that undoing a newer deletion brings back from the trash', async () => {
    const { client, workspaceId } = await signUp(h, 'Sitios de vuelta')
    const { projectId, columns } = await seedBoard(client, workspaceId)
    const bot = await agent(client, workspaceId, ['tasks:read', 'tasks:write', 'docs:read', 'docs:write', 'organize'])
    const make = async (title: string, parentId?: string) => (await client.post(`/api/projects/${projectId}/pages`, { title, ...(parentId ? { parentId } : {}) })).body.id as string
    const top = await make('Manual')
    const first = await make('Primera', top)
    const second = await make('Segunda', top)
    const inside = await make('Dentro', first)
    const outside = await make('Fuera', first)
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Destino' })).body.id as string
    const file = (await client.upload(`/api/pages/${first}/attachments`, 'x', { name: 'x.txt', type: 'text/plain' })).body.id as string

    // Moved within the page the agent then deleted, out of it, and a file taken out of it.
    await bot.post(`/api/pages/${inside}/move`, { parentId: second, index: 0 })
    const moved = await latest(client, 'pages', inside, 'page.moved')
    await bot.post(`/api/pages/${outside}/move`, { parentId: null, index: 0 })
    await bot.post(`/api/attachments/${file}/move`, { cardId: card })
    await bot.del(`/api/pages/${top}`)

    // Their old places come back with the page before the moves are undone.
    const plan = (await undo(client, { since: moved.id, dryRun: true })).plan
    expect(plan.map((p) => p.kind)).toEqual(['page.deleted', 'attachment.moved', 'attachment.moved', 'page.moved', 'page.moved'])
    expect(plan.map((p) => p.status).sort()).toEqual(['ready', 'ready', 'ready', 'ready', 'unchanged'])
    expect(await undo(client, { since: moved.id })).toMatchObject({ applied: true, undone: 4, skipped: 0, failed: 0 })
    expect((await client.get(`/api/pages/${inside}`)).body.parentId).toBe(first)
    expect((await client.get(`/api/pages/${outside}`)).body.parentId).toBe(first)
    expect((await client.get(`/api/pages/${first}`)).body.attachments.map((a: { id: string }) => a.id)).toEqual([file])
  })

  it('asks first about what someone did to what comes back from the trash, under it too', async () => {
    const { client, workspaceId } = await signUp(h, 'Bajo la papelera')
    const { projectId, boardId, columns } = await seedBoard(client, workspaceId)
    const bot = await agent(client, workspaceId, ['tasks:read', 'tasks:write', 'docs:read', 'docs:write', 'organize'])

    // Pages the agent made, one of them renamed by a person, then deleted by the agent.
    const top = (await bot.post(`/api/projects/${projectId}/pages`, { title: 'Del agente' })).body.id as string
    const made = await latest(client, 'pages', top, 'page.created')
    const sub = (await bot.post(`/api/projects/${projectId}/pages`, { title: 'Debajo', parentId: top })).body.id as string
    await client.patch(`/api/pages/${sub}`, { title: 'Debajo, revisada' })
    await bot.del(`/api/pages/${top}`)
    const pagePlan = (await undo(client, { since: made.id, dryRun: true })).plan
    expect(pagePlan.map((p) => [p.kind, p.entityId, p.status])).toEqual([
      ['page.deleted', top, 'ready'],
      ['page.created', sub, 'conflict'],
      ['page.created', top, 'conflict'],
    ])
    expect(pagePlan[2]).toMatchObject({ changedBy: { kind: 'user', name: 'Bajo la papelera' } })
    expect(await undo(client, { since: made.id })).toMatchObject({ applied: false, undone: 0 })
    expect((await client.get(`/api/pages/${top}`)).status).toBe(404)

    // A checklist the agent made on a card, with an item a person changed, then the card deleted.
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Con lista' })).body.id as string
    const list = (await bot.post(`/api/cards/${card}/checklists`, { title: 'Pasos' })).body.id as string
    const listed = await latest(client, 'cards', card, 'checklist.created')
    const item = (await client.post(`/api/checklists/${list}/items`, { text: 'Leer' })).body.id as string
    await client.patch(`/api/checklist-items/${item}`, { done: true })
    await bot.del(`/api/cards/${card}`)
    expect((await undo(client, { since: listed.id, dryRun: true })).plan.map((p) => [p.kind, p.status])).toEqual([
      ['card.deleted', 'ready'],
      ['checklist.created', 'conflict'],
    ])

    // A card whose new label someone deleted while it was in the trash comes back without it.
    const old = (await client.post(`/api/boards/${boardId}/labels`, { name: 'Vieja', color: 'tomato' })).body.id as string
    const fresh = (await client.post(`/api/boards/${boardId}/labels`, { name: 'Nueva', color: 'jade' })).body.id as string
    const labelled = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Etiquetada', labelIds: [old] })).body.id as string
    await bot.patch(`/api/cards/${labelled}`, { labelIds: [fresh] })
    const relabel = await latest(client, 'cards', labelled, 'card.labels')
    await bot.del(`/api/cards/${labelled}`)
    expect((await client.del(`/api/labels/${fresh}`)).status).toBeLessThan(300)
    expect((await undo(client, { since: relabel.id, dryRun: true })).plan.map((p) => [p.kind, p.status, p.status === 'conflict' ? p.current : undefined])).toEqual([
      ['card.deleted', 'ready', undefined],
      ['card.labels', 'conflict', []],
    ])
    expect(await undo(client, { since: relabel.id })).toMatchObject({ applied: false, undone: 0 })
    expect((await client.get(`/api/cards/${labelled}`)).status).toBe(404)
  })

  it('plans the labels a card gets back when undoing its move to another board', async () => {
    const { client, workspaceId } = await signUp(h, 'Etiquetas de vuelta')
    const { boardId, columns } = await seedBoard(client, workspaceId)
    const other = await seedBoard(client, workspaceId)
    const bot = await agent(client, workspaceId, ['tasks:read', 'tasks:write', 'docs:read', 'docs:write', 'organize'])
    const old = (await client.post(`/api/boards/${boardId}/labels`, { name: 'Vieja', color: 'tomato' })).body.id as string
    const fresh = (await client.post(`/api/boards/${boardId}/labels`, { name: 'Nueva', color: 'jade' })).body.id as string
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Etiquetada', labelIds: [old] })).body.id as string
    await bot.patch(`/api/cards/${card}`, { labelIds: [fresh] })
    await bot.post(`/api/cards/${card}/move`, { columnId: other.columns[0]!.id, index: 0 })
    const relabel = await latest(client, 'cards', card, 'card.labels')
    // Undoing the move puts back the label it lost, so the label change before it is ready, not a conflict.
    const plan = (await undo(client, { since: relabel.id, dryRun: true })).plan
    expect(plan.map((p) => [p.kind, p.status])).toEqual([
      ['card.moved', 'ready'],
      ['card.labels', 'ready'],
    ])
    expect(await undo(client, { since: relabel.id, conflicts: 'skip' })).toMatchObject({ undone: 2, skipped: 0, failed: 0 })
    const back = (await client.get(`/api/cards/${card}`)).body
    expect(back.board.id).toBe(boardId)
    expect(back.labels.map((l: { id: string }) => l.id)).toEqual([old])
  })
})
