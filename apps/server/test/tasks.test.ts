import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, type Harness, createHarness, seedBoard, signUp } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => h.close())

describe('boards and cards', () => {
  it('creates boards with default columns and orders cards', async () => {
    const { client, workspaceId } = await signUp(h)
    const { boardId, columns } = await seedBoard(client, workspaceId)
    expect(columns.map((c) => c.name)).toEqual(['To do', 'In progress', 'Done'])
    const todo = columns[0]!.id
    const a = await client.post(`/api/columns/${todo}/cards`, { title: 'A' })
    const b = await client.post(`/api/columns/${todo}/cards`, { title: 'B' })
    const top = await client.post(`/api/columns/${todo}/cards`, { title: 'Top', index: 0 })
    expect([a.status, b.status, top.status]).toEqual([201, 201, 201])
    let board = await client.get(`/api/boards/${boardId}`)
    expect(board.body.cards.map((c: { title: string }) => c.title)).toEqual(['Top', 'A', 'B'])

    // Move B between Top and A, then A to another column.
    await client.post(`/api/cards/${b.body.id}/move`, { columnId: todo, index: 1 })
    await client.post(`/api/cards/${a.body.id}/move`, { columnId: columns[2]!.id, index: 0 })
    board = await client.get(`/api/boards/${boardId}`)
    const titlesIn = (col: string) => board.body.cards.filter((c: { columnId: string }) => c.columnId === col).map((c: { title: string }) => c.title)
    expect(titlesIn(todo)).toEqual(['Top', 'B'])
    expect(titlesIn(columns[2]!.id)).toEqual(['A'])

    const detail = await client.get(`/api/cards/${a.body.id}`)
    expect(detail.body.activity.map((x: { action: string }) => x.action)).toContain('card.moved')
  })

  it('handles labels, due dates, checklists and archiving', async () => {
    const { client, workspaceId } = await signUp(h)
    const { boardId, columns } = await seedBoard(client, workspaceId)
    const label = await client.post(`/api/boards/${boardId}/labels`, { name: 'Urgente', color: 'tomato' })
    expect(label.status).toBe(201)
    const card = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Preparar demo' })
    const due = '2026-12-01T12:00:00.000Z'
    const upd = await client.patch(`/api/cards/${card.body.id}`, { labelIds: [label.body.id], dueAt: due, description: '## Notas' })
    expect(upd.body.labelIds).toEqual([label.body.id])
    expect(upd.body.dueAt).toBe(due)
    expect(upd.body.hasDescription).toBe(true)

    const list = await client.post(`/api/cards/${card.body.id}/checklists`, { title: 'Pasos' })
    const i1 = await client.post(`/api/checklists/${list.body.id}/items`, { text: 'Guion' })
    await client.post(`/api/checklists/${list.body.id}/items`, { text: 'Ensayo' })
    await client.patch(`/api/checklist-items/${i1.body.id}`, { done: true })
    const board = await client.get(`/api/boards/${boardId}`)
    expect(board.body.cards[0].checklist).toEqual({ done: 1, total: 2 })

    // A label from another board is rejected.
    const other = await seedBoard(client, workspaceId)
    const foreign = await client.post(`/api/boards/${other.boardId}/labels`, { name: 'x', color: 'jade' })
    expect((await client.patch(`/api/cards/${card.body.id}`, { labelIds: [foreign.body.id] })).status).toBe(400)

    expect((await client.post(`/api/cards/${card.body.id}/archive`)).status).toBe(204)
    expect((await client.get(`/api/boards/${boardId}`)).body.cards).toHaveLength(0)
    expect((await client.get(`/api/boards/${boardId}/archived`)).body).toHaveLength(1)
    await client.post(`/api/cards/${card.body.id}/restore`)
    expect((await client.get(`/api/boards/${boardId}`)).body.cards).toHaveLength(1)
  })

  it("names default columns in the owner's language, also for their agents", async () => {
    const { client, workspaceId } = await signUp(h)
    expect((await client.patch('/api/account', { locale: 'es' })).body.locale).toBe('es')
    expect((await seedBoard(client, workspaceId)).columns.map((c) => c.name)).toEqual(['Por hacer', 'En curso', 'Hecho'])

    const token = await client.post('/api/tokens', { name: 'Claude', workspaceId, scopes: ['tasks:write'], expiresInDays: 30 })
    const agent = new Client(h, token.body.token)
    const project = await client.post(`/api/workspaces/${workspaceId}/projects`, { name: 'Agentes' })
    const board = await agent.post(`/api/projects/${project.body.id}/boards`, { name: 'Del agente' })
    expect(board.status).toBe(201)
    const detail = await agent.get(`/api/boards/${board.body.id}`)
    expect(detail.body.columns.map((c: { name: string }) => c.name)).toEqual(['Por hacer', 'En curso', 'Hecho'])

    await client.patch('/api/account', { locale: 'ja' })
    expect((await seedBoard(client, workspaceId)).columns.map((c) => c.name)).toEqual(['未着手', '進行中', '完了'])
  })

  it('reorders columns and refuses invalid moves', async () => {
    const { client, workspaceId } = await signUp(h)
    const { boardId, columns } = await seedBoard(client, workspaceId)
    await client.patch(`/api/columns/${columns[2]!.id}`, { index: 0 })
    const board = await client.get(`/api/boards/${boardId}`)
    expect(board.body.columns.map((c: { name: string }) => c.name)).toEqual(['Done', 'To do', 'In progress'])
    const other = await seedBoard(client, workspaceId)
    const card = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'X' })
    expect((await client.post(`/api/cards/${card.body.id}/move`, { columnId: other.columns[0]!.id, index: 0 })).status).toBe(400)
  })
})
