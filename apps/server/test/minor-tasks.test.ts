import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Harness, createHarness, seedBoard, signUp } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => h.close())

type Entry = { action: string; entityId: string; meta: Record<string, unknown> }
const entriesFor = (entries: Entry[], id: string, action: string) => entries.filter((e) => e.entityId === id && e.action === action)

describe('small fixes in tasks', () => {
  it('archiving or restoring twice changes nothing the second time', async () => {
    const { client, workspaceId } = await signUp(h)
    const { boardId, columns } = await seedBoard(client, workspaceId)
    const todo = columns[0]!.id
    const first = await client.post(`/api/columns/${todo}/cards`, { title: 'Primera' })
    await client.post(`/api/columns/${todo}/cards`, { title: 'Segunda' })

    // Restoring a card that is not archived leaves it where it is.
    expect((await client.post(`/api/cards/${first.body.id}/restore`)).status).toBe(204)
    const board = await client.get(`/api/boards/${boardId}`)
    expect(board.body.cards.map((c: { title: string }) => c.title)).toEqual(['Primera', 'Segunda'])

    expect((await client.post(`/api/cards/${first.body.id}/archive`)).status).toBe(204)
    expect((await client.post(`/api/cards/${first.body.id}/archive`)).status).toBe(204)
    const activity = await client.get(`/api/workspaces/${workspaceId}/activity`)
    expect(entriesFor(activity.body, first.body.id, 'card.archived')).toHaveLength(1)
    expect(entriesFor(activity.body, first.body.id, 'card.restored')).toHaveLength(0)
  })

  it('an empty edit of a card or a label is a no-op, not an error or an entry', async () => {
    const { client, workspaceId } = await signUp(h)
    const { boardId, columns } = await seedBoard(client, workspaceId)
    const card = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Sin cambios' })
    const label = await client.post(`/api/boards/${boardId}/labels`, { name: 'Urgente', color: 'tomato' })

    const sameCard = await client.patch(`/api/cards/${card.body.id}`, {})
    expect(sameCard.status).toBe(200)
    expect(sameCard.body.title).toBe('Sin cambios')
    const sameLabel = await client.patch(`/api/labels/${label.body.id}`, {})
    expect(sameLabel.status).toBe(200)
    expect(sameLabel.body).toMatchObject({ name: 'Urgente', color: 'tomato' })

    const activity = await client.get(`/api/workspaces/${workspaceId}/activity`)
    expect(entriesFor(activity.body, card.body.id, 'card.updated')).toHaveLength(0)
    expect(entriesFor(activity.body, label.body.id, 'label.updated')).toHaveLength(0)
  })

  it('an edit with the values a card or a label already has changes nothing: no version, no conflict, no entry', async () => {
    const { client, workspaceId } = await signUp(h)
    const { boardId, columns } = await seedBoard(client, workspaceId)
    const label = (await client.post(`/api/boards/${boardId}/labels`, { name: 'Urgente', color: 'tomato' })).body.id as string
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Igual', description: 'Texto', dueAt: '2026-12-24', labelIds: [label] })).body.id as string
    const before = (await client.get(`/api/cards/${card}`)).body
    const history = async () => ((await client.get(`/api/cards/${card}/history`)).body as unknown[]).length
    const kept = await history()

    // An agent sends everything again, as it is.
    const same = await client.patch(`/api/cards/${card}`, { title: 'Igual', description: 'Texto', dueAt: '2026-12-24T12:00:00.000Z', labelIds: [label] })
    expect(same.status).toBe(200)
    const after = (await client.get(`/api/cards/${card}`)).body
    expect([after.version, after.updatedAt]).toEqual([before.version, before.updatedAt])
    expect(await history()).toBe(kept)
    // The person's save from the version they had still goes through: nobody changed the text.
    const mine = await client.patch(`/api/cards/${card}`, { description: 'Texto mío', baseVersion: before.version })
    expect(mine.status).toBe(200)
    expect((await client.get(`/api/cards/${card}`)).body.version).toBe(before.version + 1)
    // The same text from an older version is no conflict either: there is nothing to save.
    expect((await client.patch(`/api/cards/${card}`, { description: 'Texto mío', baseVersion: before.version })).status).toBe(200)
    // Only what differs is told.
    expect((await client.patch(`/api/cards/${card}`, { title: 'Igual', description: 'Texto mío', dueAt: '2026-12-31' })).status).toBe(200)

    expect((await client.patch(`/api/labels/${label}`, { name: 'Urgente', color: 'tomato' })).status).toBe(200)
    const activity = (await client.get(`/api/workspaces/${workspaceId}/activity`)).body
    const [edits] = entriesFor(activity, card, 'card.updated')
    expect(String(edits!.meta.fields).split(',').sort()).toEqual(['description', 'dueAt'])
    expect(entriesFor(activity, label, 'label.updated')).toHaveLength(0)
    expect((await client.patch(`/api/labels/${label}`, { name: 'Muy urgente', color: 'tomato' })).status).toBe(200)
    expect(entriesFor((await client.get(`/api/workspaces/${workspaceId}/activity`)).body, label, 'label.updated')).toHaveLength(1)
  })

  it('edits folded into one entry list every field edited, and a page linked twice is told once', async () => {
    const { client, workspaceId } = await signUp(h)
    const { projectId, columns } = await seedBoard(client, workspaceId)
    const card = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Borrador' })
    await client.patch(`/api/cards/${card.body.id}`, { title: 'Versión final' })
    await client.patch(`/api/cards/${card.body.id}`, { description: 'Notas' })
    await client.patch(`/api/cards/${card.body.id}`, { title: 'Versión final de verdad' })

    const page = await client.post(`/api/projects/${projectId}/pages`, { title: 'Especificación' })
    expect((await client.post(`/api/cards/${card.body.id}/pages`, { pageId: page.body.id })).status).toBe(204)
    expect((await client.post(`/api/cards/${card.body.id}/pages`, { pageId: page.body.id })).status).toBe(204)

    const activity = await client.get(`/api/workspaces/${workspaceId}/activity`)
    const [edits] = entriesFor(activity.body, card.body.id, 'card.updated')
    expect(String(edits!.meta.fields).split(',').sort()).toEqual(['description', 'title'])
    expect(entriesFor(activity.body, card.body.id, 'card.updated')).toHaveLength(1)
    expect(entriesFor(activity.body, card.body.id, 'card.linked')).toHaveLength(1)
  })

  it('two edits at once keep both fields in the entry they fold into', async () => {
    const { client, workspaceId } = await signUp(h)
    const { columns } = await seedBoard(client, workspaceId)
    const card = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'A la vez' })
    await client.patch(`/api/cards/${card.body.id}`, { title: 'A la vez, retitulada' })
    await Promise.all([client.patch(`/api/cards/${card.body.id}`, { description: 'Texto' }), client.patch(`/api/cards/${card.body.id}`, { dueAt: '2026-12-24' })])
    const activity = await client.get(`/api/workspaces/${workspaceId}/activity`)
    const [edits] = entriesFor(activity.body, card.body.id, 'card.updated')
    expect(String(edits!.meta.fields).split(',').sort()).toEqual(['description', 'dueAt', 'title'])
  })

  it('a limit that is not a whole number from 1 is refused, not a server error or every row', async () => {
    const { client, workspaceId } = await signUp(h)
    const { columns } = await seedBoard(client, workspaceId)
    const card = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Con historial' })
    for (const limit of ['2.5', 'abc', '-1', '0']) {
      const activity = await client.get(`/api/workspaces/${workspaceId}/activity?limit=${limit}`)
      expect(activity.status, `activity limit=${limit}`).toBe(400)
      const history = await client.get(`/api/cards/${card.body.id}/history?limit=${limit}`)
      expect(history.status, `history limit=${limit}`).toBe(400)
    }
    const one = await client.get(`/api/workspaces/${workspaceId}/activity?limit=1`)
    expect(one.status).toBe(200)
    expect(one.body).toHaveLength(1)
    // A date that is not one is ignored, as in the history.
    expect((await client.get(`/api/workspaces/${workspaceId}/activity?before=nonsense`)).status).toBe(200)
  })

  it('names must show something, and control characters become spaces', async () => {
    const { client, workspaceId } = await signUp(h)
    const { columns } = await seedBoard(client, workspaceId)
    for (const title of ['​', '​ ​', '\u0000', 'ㅤ']) {
      const res = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title })
      expect(res.status, JSON.stringify(title)).toBe(400)
    }
    const res = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Línea\nuna\tmás\u0007' })
    expect(res.status).toBe(201)
    expect(res.body.title).toBe('Línea una más')
    const project = await client.post(`/api/workspaces/${workspaceId}/projects`, { name: '​‌', color: 'tomato' })
    expect(project.status).toBe(400)
  })

  it('a name made only of marks (an emoji variation selector, accents) shows nothing, and is refused', async () => {
    const { client, workspaceId } = await signUp(h)
    const { boardId, columns } = await seedBoard(client, workspaceId)
    for (const title of ['\uFE0F', '\u0301\u0308', ' \uFE0F\u20E3 ', '\u{E0100}']) {
      const res = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title })
      expect(res.status, JSON.stringify(title)).toBe(400)
    }
    expect((await client.post(`/api/boards/${boardId}/columns`, { name: '\uFE0F' })).status).toBe(400)
    expect((await client.post(`/api/workspaces/${workspaceId}/projects`, { name: '\u0301', color: 'tomato' })).status).toBe(400)
    // A mark on a character that shows is part of a name.
    for (const title of ['❤️', 'é', '1️⃣']) {
      const res = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title })
      expect(res.status, JSON.stringify(title)).toBe(201)
      expect(res.body.title).toBe(title)
    }
  })

  it('label names are cleaned as other names: line breaks become spaces, one that shows nothing is no name', async () => {
    const { client, workspaceId } = await signUp(h)
    const { boardId } = await seedBoard(client, workspaceId)
    const created = await client.post(`/api/boards/${boardId}/labels`, { name: ' Muy\nurgente\t', color: 'tomato' })
    expect(created.status).toBe(201)
    expect(created.body.name).toBe('Muy urgente')
    for (const name of ['\u200B', '\uFE0F', 'ㅤ', '\u0000']) {
      const res = await client.post(`/api/boards/${boardId}/labels`, { name, color: 'teal' })
      expect(res.status, JSON.stringify(name)).toBe(201)
      expect(res.body.name, JSON.stringify(name)).toBe('')
    }
    const renamed = await client.patch(`/api/labels/${created.body.id}`, { name: 'Dos\r\nlíneas' })
    expect(renamed.status).toBe(200)
    expect(renamed.body.name).toBe('Dos líneas')
    const blanked = await client.patch(`/api/labels/${created.body.id}`, { name: '\u200B\u200C' })
    expect(blanked.status).toBe(200)
    expect(blanked.body.name).toBe('')
  })

  it('a board holds up to 20 columns, also once created', async () => {
    const { client, workspaceId } = await signUp(h)
    const { boardId, columns } = await seedBoard(client, workspaceId)
    for (let i = columns.length; i < 20; i++) {
      expect((await client.post(`/api/boards/${boardId}/columns`, { name: `Columna ${i + 1}` })).status).toBe(201)
    }
    const extra = await client.post(`/api/boards/${boardId}/columns`, { name: 'Una más' })
    expect(extra.status).toBe(400)
    expect(extra.body.error.code).toBe('too_many_columns')
    expect((await client.get(`/api/boards/${boardId}`)).body.columns).toHaveLength(20)
  })

  it('two columns added at once to a board with 19 do not make 21', async () => {
    const { client, workspaceId } = await signUp(h)
    const { boardId, columns } = await seedBoard(client, workspaceId)
    for (let i = columns.length; i < 19; i++) await client.post(`/api/boards/${boardId}/columns`, { name: `Columna ${i + 1}` })
    const both = await Promise.all([1, 2].map((n) => client.post(`/api/boards/${boardId}/columns`, { name: `A la vez ${n}` })))
    expect(both.map((r) => r.status).sort()).toEqual([201, 400])
    expect((await client.get(`/api/boards/${boardId}`)).body.columns).toHaveLength(20)
  })
})
