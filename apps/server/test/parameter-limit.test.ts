import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAX_PARAMETERS } from '../src/db/groups'
import { type Client, type Harness, countParameters, createHarness, seedBoard, signUp } from './harness'

// The harness refuses, as SQLite in a Durable Object does, any query with more than 100 parameters:
// these cases failed on Cloudflare while working on Node.
let h: Harness
let client: Client
let workspaceId: string
beforeAll(async () => {
  h = await createHarness()
  ;({ client, workspaceId } = await signUp(h))
})
afterAll(async () => h.close())

describe('the 100 parameters a query takes on Cloudflare', () => {
  it('is enforced by the tests themselves', () => {
    expect(countParameters(`SELECT '?', "?" -- ?\n, ?, /* ? */ ?`)).toBe(2)
    const params = Array.from({ length: MAX_PARAMETERS + 1 }, (_, i) => i)
    expect(() => [...h.sql.rows(`SELECT ${params.map(() => '?').join(', ')}`, ...params)]).toThrow(/too many SQL variables/)
    expect([...h.sql.rows(`SELECT ${params.slice(1).map(() => '?').join(', ')}`, ...params.slice(1))]).toHaveLength(1)
  })

  it('saves a page that mentions 150 cards, and links each one', async () => {
    const { projectId, columns } = await seedBoard(client, workspaceId)
    const cards: string[] = []
    for (let i = 0; i < 150; i++) cards.push((await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: `Tarjeta ${i}` })).body.id as string)
    const mentions = (ids: string[]) => ids.map((id, i) => `- [Tarjeta ${i}](/card/${id})`).join('\n')

    const created = await client.post(`/api/projects/${projectId}/pages`, { title: 'Sprint', content: mentions(cards.slice(0, 25)) })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const { version } = (await client.get(`/api/pages/${created.body.id}`)).body
    const updated = await client.patch(`/api/pages/${created.body.id}`, { content: mentions(cards), baseVersion: version })
    expect(updated.status, JSON.stringify(updated.body)).toBe(200)
    for (const card of [cards[0]!, cards[99]!, cards[149]!]) {
      expect((await client.get(`/api/cards/${card}`)).body.pages.map((p: { id: string }) => p.id)).toEqual([created.body.id])
    }
  })

  it('creates a board with its 20 columns in one request', async () => {
    const { projectId } = await seedBoard(client, workspaceId)
    const names = Array.from({ length: 20 }, (_, i) => `Columna ${i + 1}`)
    const board = await client.post(`/api/projects/${projectId}/boards`, { name: 'Ancho', columns: names })
    expect(board.status, JSON.stringify(board.body)).toBe(201)
    expect((await client.get(`/api/boards/${board.body.id}`)).body.columns.map((c: { name: string }) => c.name)).toEqual(names)
  })

  it('opens a card with 101 checklists', async () => {
    const { columns } = await seedBoard(client, workspaceId)
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Muchas listas' })).body.id as string
    for (let i = 0; i < 101; i++) expect((await client.post(`/api/cards/${card}/checklists`, { title: `Lista ${i}` })).status).toBe(201)
    const res = await client.get(`/api/cards/${card}`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.checklists).toHaveLength(101)
  })
})
