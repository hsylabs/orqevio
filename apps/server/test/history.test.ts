import { HISTORY_DAYS, type HistoryEntryDTO, type Scope } from '@orqevio/shared'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { history } from '../src/db/schema'
import { Client, type Harness, createHarness, seedBoard, signUp } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => h.close())
afterEach(() => {
  vi.useRealTimers()
})

const list = async (client: Client, type: 'pages' | 'cards', id: string) => {
  const res = await client.get(`/api/${type}/${id}/history`)
  expect(res.status).toBe(200)
  return res.body as HistoryEntryDTO[]
}
const kinds = (entries: HistoryEntryDTO[]) => entries.map((e) => e.kind)

async function agent(client: Client, workspaceId: string, scopes: Scope[] = ['tasks:read', 'tasks:write', 'docs:read', 'docs:write'], name = 'Asistente') {
  const res = await client.post('/api/tokens', { name, workspaceId, scopes, expiresInDays: 30 })
  expect(res.status).toBe(201)
  return { client: new Client(h, res.body.token), id: res.body.id as string }
}

/** Moves the clock on, for edits that should land in a new stretch of work. */
const later = (minutes: number) => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.now() + minutes * 60_000)
}

describe('the history', () => {
  it('records each change to a page, with who made it and the text before and after', async () => {
    const { client, workspaceId, user } = await signUp(h)
    const { projectId } = await seedBoard(client, workspaceId)
    const parent = (await client.post(`/api/projects/${projectId}/pages`, { title: 'Guías' })).body.id as string
    const page = (await client.post(`/api/projects/${projectId}/pages`, { title: 'Onboarding', content: 'Bienvenida\nPaso 1' })).body.id as string
    expect(kinds(await list(client, 'pages', page))).toEqual(['page.content', 'page.created'])

    // The editor saves as people type: one change for the whole stretch, here since the page was made.
    let version = (await client.get(`/api/pages/${page}`)).body.version as number
    version = (await client.patch(`/api/pages/${page}`, { content: 'Bienvenida\nPaso 1\nPaso 2', baseVersion: version })).body.version
    version = (await client.patch(`/api/pages/${page}`, { content: 'Bienvenida\nPaso 1 revisado\nPaso 2', baseVersion: version })).body.version
    // An agent's write is always a version of its own, and so is what comes after it.
    const bot = await agent(client, workspaceId)
    version = (await bot.client.patch(`/api/pages/${page}`, { content: 'Bienvenida\nPaso 1 revisado\nPaso 2\nPaso 3', baseVersion: version })).body.version
    await client.patch(`/api/pages/${page}`, { content: 'Hola\nPaso 1 revisado\nPaso 2\nPaso 3', baseVersion: version })
    await client.patch(`/api/pages/${page}`, { title: 'Primeros pasos', icon: '🚀' })
    await client.post(`/api/pages/${page}/move`, { parentId: parent, index: 0 })

    const entries = await list(client, 'pages', page)
    expect(kinds(entries)).toEqual(['page.moved', 'page.icon', 'page.title', 'page.content', 'page.content', 'page.content', 'page.created'])
    const [moved, icon, title, mine, theirs, edited] = entries
    expect(moved).toMatchObject({ before: { projectId, parentId: null }, after: { projectId, parentId: parent }, meta: { from: null, to: 'Guías' } })
    expect(icon).toMatchObject({ before: null, after: '🚀' })
    expect(title).toMatchObject({ before: 'Onboarding', after: 'Primeros pasos', actor: { kind: 'user', id: user.id } })
    expect(theirs).toMatchObject({ actor: { kind: 'agent', id: bot.id, name: 'Asistente' }, meta: { linesAdded: 1, linesRemoved: 0 } })
    // Lists leave long texts out; the entry itself has them.
    expect(edited).toMatchObject({ before: null, after: null, meta: { linesAdded: 3, linesRemoved: 0 } })
    expect((await client.get(`/api/history/${edited!.id}`)).body).toMatchObject({ before: '', after: 'Bienvenida\nPaso 1 revisado\nPaso 2' })
    expect((await client.get(`/api/history/${mine!.id}`)).body).toMatchObject({ before: 'Bienvenida\nPaso 1 revisado\nPaso 2\nPaso 3', after: 'Hola\nPaso 1 revisado\nPaso 2\nPaso 3' })
    // The person and the agent each worked in their own batch.
    expect(theirs!.batchId).not.toBe(edited!.batchId)
    expect(new Set([moved, icon, title, mine].map((e) => e!.batchId)).size).toBe(1)

    // Deleting and restoring say so, and the history waits in the trash with the page.
    const trashId = (await client.del(`/api/pages/${page}`)).body.trashId as string
    expect((await client.get(`/api/pages/${page}/history`)).status).toBe(404)
    expect((await client.get(`/api/history/${edited!.id}`)).status).toBe(404)
    expect((await client.post(`/api/trash/${trashId}/restore`)).status).toBe(200)
    const back = await list(client, 'pages', page)
    expect(kinds(back).slice(0, 2)).toEqual(['page.restored', 'page.deleted'])
    expect(back[1]!.meta.trashId).toBe(trashId)
    expect(back).toHaveLength(entries.length + 2)
  })

  it('records changes to a card and to what it holds', async () => {
    const { client, workspaceId } = await signUp(h, 'Marta')
    const { projectId, boardId, columns } = await seedBoard(client, workspaceId)
    const urgent = (await client.post(`/api/boards/${boardId}/labels`, { name: 'Urgente', color: 'tomato' })).body.id as string
    const bug = (await client.post(`/api/boards/${boardId}/labels`, { name: 'Bug', color: 'cobalt' })).body.id as string
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Arreglar login', description: 'Falla en Safari' })).body.id as string
    await client.patch(`/api/cards/${card}`, { title: 'Arreglar el login', dueAt: '2026-12-01T09:00:00.000Z', labelIds: [urgent] })
    await client.patch(`/api/cards/${card}`, { labelIds: [bug] })
    await client.post(`/api/cards/${card}/move`, { columnId: columns[1]!.id, index: 0 })
    await client.post(`/api/cards/${card}/archive`)
    await client.post(`/api/cards/${card}/restore`)
    const list1 = (await client.post(`/api/cards/${card}/checklists`, { title: 'Pasos' })).body.id as string
    await client.patch(`/api/checklists/${list1}`, { title: 'Pasos a seguir' })
    const item = (await client.post(`/api/checklists/${list1}/items`, { text: 'Reproducir' })).body.id as string
    await client.patch(`/api/checklist-items/${item}`, { text: 'Reproducirlo' })
    await client.patch(`/api/checklist-items/${item}`, { done: true })
    const page = (await client.post(`/api/projects/${projectId}/pages`, { title: 'Informe' })).body.id as string
    await client.post(`/api/cards/${card}/pages`, { pageId: page })
    await client.post(`/api/cards/${card}/pages`, { pageId: page })
    await client.del(`/api/cards/${card}/pages/${page}`)
    const file = (await client.upload(`/api/cards/${card}/attachments`, 'log', { name: 'error.log', type: 'text/plain' })).body.id as string
    await client.del(`/api/attachments/${file}`)
    const itemTrash = (await client.del(`/api/checklist-items/${item}`)).body.trashId as string
    await client.post(`/api/trash/${itemTrash}/restore`)

    const entries = await list(client, 'cards', card)
    expect(kinds(entries).reverse()).toEqual([
      'card.created',
      'card.description',
      'card.title',
      'card.due',
      'card.labels',
      'card.labels',
      'card.moved',
      'card.archived',
      'card.archived',
      'checklist.created',
      'checklist.title',
      'item.created',
      'item.text',
      'item.done',
      'card.linked',
      'card.unlinked',
      'attachment.created',
      'attachment.deleted',
      'item.deleted',
      'item.restored',
    ])
    const by = (kind: string) => entries.filter((e) => e.kind === kind).reverse()
    expect(by('card.created')[0]!.meta).toMatchObject({ title: 'Arreglar login', column: columns[0]!.name })
    // A due date is the day it names, kept at 12:00 UTC.
    expect(by('card.due')[0]).toMatchObject({ before: null, after: '2026-12-01T12:00:00.000Z' })
    expect(by('card.labels').map((e) => e.meta)).toEqual([
      { added: ['Urgente'], removed: [] },
      { added: ['Bug'], removed: ['Urgente'] },
    ])
    expect(by('card.labels')[1]).toMatchObject({ before: [urgent], after: [bug] })
    expect(by('card.moved')[0]).toMatchObject({
      before: { boardId, columnId: columns[0]!.id },
      after: { boardId, columnId: columns[1]!.id },
      meta: { from: columns[0]!.name, to: columns[1]!.name },
    })
    expect(by('card.archived').map((e) => [e.before, e.after])).toEqual([
      [false, true],
      [true, false],
    ])
    expect(by('checklist.title')[0]).toMatchObject({ subjectId: list1, before: 'Pasos', after: 'Pasos a seguir' })
    expect(by('item.text')[0]).toMatchObject({ subjectId: item, before: 'Reproducir', after: 'Reproducirlo' })
    expect(by('item.done')[0]).toMatchObject({ before: false, after: true, meta: { text: 'Reproducirlo' } })
    expect(by('card.linked')[0]).toMatchObject({ subjectId: page, meta: { page: 'Informe' } })
    expect(by('attachment.deleted')[0]).toMatchObject({ subjectId: file, meta: { name: 'error.log' } })
    expect(by('item.restored')[0]).toMatchObject({ subjectId: item, meta: { text: 'Reproducirlo', trashId: itemTrash } })
    // Files of a page are in the page's history.
    await client.upload(`/api/pages/${page}/attachments`, 'img', { name: 'captura.png', type: 'image/png' })
    expect(kinds(await list(client, 'pages', page))).toEqual(['attachment.created', 'page.created'])
  })

  it('keeps a person’s edits of one text in one change, drops it when typed back, and starts anew after a pause', async () => {
    const { client, workspaceId } = await signUp(h, 'Pausas')
    const { columns } = await seedBoard(client, workspaceId)
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'A' })).body.id as string
    await client.patch(`/api/cards/${card}`, { title: 'B' })
    await client.patch(`/api/cards/${card}`, { title: 'C' })
    expect((await list(client, 'cards', card)).filter((e) => e.kind === 'card.title').map((e) => [e.before, e.after])).toEqual([['A', 'C']])
    await client.patch(`/api/cards/${card}`, { title: 'A' })
    expect(kinds(await list(client, 'cards', card))).toEqual(['card.created'])
    // Saving the same value records nothing.
    await client.patch(`/api/cards/${card}`, { title: 'A', description: '' })
    expect(kinds(await list(client, 'cards', card))).toEqual(['card.created'])

    await client.patch(`/api/cards/${card}`, { title: 'D' })
    const first = (await list(client, 'cards', card))[0]!
    later(11)
    await client.patch(`/api/cards/${card}`, { title: 'E' })
    const entries = (await list(client, 'cards', card)).filter((e) => e.kind === 'card.title')
    expect(entries.map((e) => [e.before, e.after])).toEqual([
      ['D', 'E'],
      ['A', 'D'],
    ])
    // A new stretch of work is a new batch too.
    expect(entries[0]!.batchId).not.toBe(first.batchId)
  })

  it('puts what an agent does in one stretch of work in one batch, and each of its writes in its own change', async () => {
    const { client, workspaceId } = await signUp(h, 'Lotes')
    const { columns } = await seedBoard(client, workspaceId)
    const bot = await agent(client, workspaceId)
    const card = (await bot.client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Plan' })).body.id as string
    await bot.client.patch(`/api/cards/${card}`, { title: 'Plan v2' })
    await bot.client.patch(`/api/cards/${card}`, { title: 'Plan v3' })
    await bot.client.post(`/api/cards/${card}/move`, { columnId: columns[1]!.id, index: 0 })
    const other = (await bot.client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Otra' })).body.id as string
    const entries = [...(await list(client, 'cards', card)), ...(await list(client, 'cards', other))]
    expect(kinds(entries)).toEqual(['card.moved', 'card.title', 'card.title', 'card.created', 'card.created'])
    expect(new Set(entries.map((e) => e.batchId)).size).toBe(1)
    // Another agent, or the same one later, is another batch.
    const second = await agent(client, workspaceId, undefined, 'Otro asistente')
    await second.client.patch(`/api/cards/${card}`, { title: 'Plan v4' })
    later(11)
    await bot.client.patch(`/api/cards/${card}`, { title: 'Plan v5' })
    const [v5, v4] = await list(client, 'cards', card)
    expect(new Set([v5!.batchId, v4!.batchId, entries[0]!.batchId]).size).toBe(3)
  })

  it('pages through every change, also those made in the same millisecond', async () => {
    const { client, workspaceId } = await signUp(h, 'Páginas')
    const { columns } = await seedBoard(client, workspaceId)
    const bot = await agent(client, workspaceId)
    const card = (await bot.client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'T0' })).body.id as string
    // The clock stands still: every change lands on the same millisecond.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 60_000)
    for (let i = 1; i <= 6; i++) await bot.client.patch(`/api/cards/${card}`, { title: `T${i}` })
    vi.useRealTimers()
    const all = await list(client, 'cards', card)
    expect(all).toHaveLength(7)
    // Two at a time, as the app does with 50: from where the last page ended.
    const seen: HistoryEntryDTO[] = []
    let query = ''
    for (let guard = 0; guard < 10; guard++) {
      const page = (await client.get(`/api/cards/${card}/history?limit=2${query}`)).body as HistoryEntryDTO[]
      seen.push(...page)
      if (page.length < 2) break
      const last = page.at(-1)!
      query = `&before=${encodeURIComponent(last.updatedAt)}&beforeId=${last.id}`
    }
    expect(seen.map((e) => e.id)).toEqual(all.map((e) => e.id))
  })

  it('is for whoever can read the page or card', async () => {
    const { client, workspaceId } = await signUp(h, 'Lectores')
    const { projectId, columns } = await seedBoard(client, workspaceId)
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Privada' })).body.id as string
    const page = (await client.post(`/api/projects/${projectId}/pages`, { title: 'Privada' })).body.id as string
    const [entry] = await list(client, 'cards', card)

    const tasks = await agent(client, workspaceId, ['tasks:read'])
    expect((await tasks.client.get(`/api/cards/${card}/history`)).status).toBe(200)
    expect((await tasks.client.get(`/api/history/${entry!.id}`)).status).toBe(200)
    expect((await tasks.client.get(`/api/pages/${page}/history`)).status).toBe(403)
    const docs = await agent(client, workspaceId, ['docs:read'])
    expect((await docs.client.get(`/api/cards/${card}/history`)).status).toBe(403)
    expect((await docs.client.get(`/api/history/${entry!.id}`)).status).toBe(403)

    const stranger = await signUp(h, 'Ajeno')
    expect((await stranger.client.get(`/api/cards/${card}/history`)).status).toBe(404)
    expect((await stranger.client.get(`/api/history/${entry!.id}`)).status).toBe(404)
  })

  it('leaves out the titles of what a token can’t read', async () => {
    const { client, workspaceId } = await signUp(h, 'Títulos')
    const { projectId, columns } = await seedBoard(client, workspaceId)
    const page = (await client.post(`/api/projects/${projectId}/pages`, { title: 'Plan secreto' })).body.id as string
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Tarea visible' })).body.id as string
    expect((await client.post(`/api/cards/${card}/pages`, { pageId: page })).status).toBeLessThan(300)
    const file = (await client.upload(`/api/cards/${card}/attachments`, 'x', { name: 'x.txt', type: 'text/plain' })).body.id as string
    expect((await client.post(`/api/attachments/${file}/move`, { pageId: page })).status).toBe(200)
    expect((await client.del(`/api/cards/${card}/pages/${page}`)).status).toBe(200)
    const tasks = (await agent(client, workspaceId, ['tasks:read'])).client
    const docs = (await agent(client, workspaceId, ['docs:read'])).client
    const both = (await agent(client, workspaceId, ['tasks:read', 'docs:read'])).client

    // A token for tasks only sees no page title: not in the card's history, one of its changes or its activity.
    const cardHistory = await list(tasks, 'cards', card)
    expect(kinds(cardHistory)).toEqual(expect.arrayContaining(['card.linked', 'card.unlinked', 'attachment.moved']))
    for (const entry of cardHistory) {
      expect(JSON.stringify(entry)).not.toContain('Plan secreto')
      expect(JSON.stringify((await tasks.get(`/api/history/${entry.id}`)).body)).not.toContain('Plan secreto')
    }
    expect(cardHistory.find((e) => e.kind === 'attachment.moved')!.meta).toEqual({ name: 'x.txt', from: 'Tarea visible' })
    const detail = (await tasks.get(`/api/cards/${card}`)).body
    expect(detail.activity.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['card.linked', 'card.unlinked']))
    expect(JSON.stringify(detail)).not.toContain('Plan secreto')

    // A token for docs only sees no card title in the page's history.
    const pageHistory = await list(docs, 'pages', page)
    expect(JSON.stringify(pageHistory)).not.toContain('Tarea visible')
    expect(pageHistory.find((e) => e.kind === 'attachment.moved')!.meta).toEqual({ name: 'x.txt', to: 'Plan secreto' })

    // With both, and for people, everything is there.
    expect(JSON.stringify(await list(both, 'cards', card))).toContain('Plan secreto')
    expect(JSON.stringify(await list(client, 'pages', page))).toContain('Tarea visible')
    expect(JSON.stringify((await client.get(`/api/cards/${card}`)).body.activity)).toContain('Plan secreto')
  })

  it('forgets each change after 30 days, and everything about what is deleted for good', async () => {
    const { client, workspaceId } = await signUp(h, 'Olvido')
    const { columns } = await seedBoard(client, workspaceId)
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Temporal' })).body.id as string
    const list1 = (await client.post(`/api/cards/${card}/checklists`, { title: 'Pasos' })).body.id as string
    const item = (await client.post(`/api/checklists/${list1}/items`, { text: 'Uno' })).body.id as string
    await client.patch(`/api/checklist-items/${item}`, { text: 'Uno bis' })

    // Deleting a checklist for good takes its changes out of the card's history.
    const listTrash = (await client.del(`/api/checklists/${list1}`)).body.trashId as string
    expect((await client.del(`/api/trash/${listTrash}`)).status).toBe(204)
    expect(kinds(await list(client, 'cards', card))).toEqual(['card.created'])

    // A card deleted for good leaves nothing behind.
    const cardTrash = (await client.del(`/api/cards/${card}`)).body.trashId as string
    expect(h.db.select().from(history).where(eq(history.entityId, card)).all()).toHaveLength(2)
    expect((await client.del(`/api/trash/${cardTrash}`)).status).toBe(204)
    expect(h.db.select().from(history).where(eq(history.entityId, card)).all()).toEqual([])

    const kept = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Dura' })).body.id as string
    expect(await h.services.history.purgeExpired(new Date(Date.now() + (HISTORY_DAYS - 1) * 86_400_000))).toBe(0)
    expect(await h.services.history.purgeExpired(new Date(Date.now() + HISTORY_DAYS * 86_400_000 + 1000))).toBeGreaterThanOrEqual(1)
    expect(await list(client, 'cards', kept)).toEqual([])
  })

  it('keeps the longest texts whole', async () => {
    const { client, workspaceId } = await signUp(h, 'Largo')
    const { projectId } = await seedBoard(client, workspaceId)
    const long = (char: string) => `${char.repeat(99)}\n`.repeat(2000)
    const page = (await client.post(`/api/projects/${projectId}/pages`, { title: 'Largo', content: long('a') })).body.id as string
    const version = (await client.get(`/api/pages/${page}`)).body.version as number
    const bot = await agent(client, workspaceId)
    expect((await bot.client.patch(`/api/pages/${page}`, { content: long('語'), baseVersion: version })).status).toBe(200)
    const [entry] = await list(client, 'pages', page)
    expect(entry!.meta).toMatchObject({ linesAdded: 2000, linesRemoved: 2000 })
    const full = (await client.get(`/api/history/${entry!.id}`)).body as HistoryEntryDTO
    expect([full.before, full.after]).toEqual([long('a'), long('語')])
  })
})
