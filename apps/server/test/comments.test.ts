import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { type CommentDTO, type CommentPageDTO, type HistoryEntryDTO, MAX_COMMENT, type RealtimeEvent, type TrashNodeDTO, type TrashTreeDTO, type UndoResultDTO } from '@orqevio/shared'
import { strFromU8, unzipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, type Harness, ORIGIN, createHarness, seedBoard, signUp } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => h.close())

async function token(client: Client, workspaceId: string, scopes: string[], name = 'Claude') {
  const res = await client.post('/api/tokens', { name, workspaceId, scopes, expiresInDays: 30 })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return res.body as { id: string; token: string }
}

async function connect(bearer: string) {
  const client = new McpClient({ name: 'test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost:3000/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
    fetch: async (url, init) => h.app.request(String(url), init as RequestInit),
  })
  await client.connect(transport)
  return client
}

const text = (result: unknown) => (result as { content: Array<{ text: string }> }).content[0]!.text
const data = (result: unknown) => JSON.parse(text(result))
const failed = (result: unknown) => (result as { isError?: boolean }).isError === true

async function setup() {
  const owner = await signUp(h)
  const board = await seedBoard(owner.client, owner.workspaceId)
  const card = (await owner.client.post(`/api/columns/${board.columns[0]!.id}/cards`, { title: 'Contrato de alquiler' })).body.id as string
  return { ...owner, ...board, card }
}

const comments = async (client: Client, card: string, query = '') => {
  const res = await client.get(`/api/cards/${card}/comments${query}`)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as CommentPageDTO
}
const historyOf = async (client: Client, card: string) => (await client.get(`/api/cards/${card}/history`)).body as HistoryEntryDTO[]

describe('comments on cards', () => {
  it('lets the person write, edit and delete their own, newest first, with the history and the trash', async () => {
    const { client, card, workspaceId } = await setup()
    const first = await client.post(`/api/cards/${card}/comments`, { body: '\n\n  Primero **revisar** la cláusula 4.   \n' })
    expect(first.status, JSON.stringify(first.body)).toBe(201)
    // Blank lines before it and spaces after it go; the spaces that start its first line stay.
    expect(first.body).toMatchObject({ body: '  Primero **revisar** la cláusula 4.', author: { kind: 'user', name: 'Ana López' }, editedAt: null, canEdit: true, canDelete: true })
    const second = (await client.post(`/api/cards/${card}/comments`, { body: 'Hecho: firmado.' })).body as CommentDTO

    const page = await comments(client, card)
    expect(page.total).toBe(2)
    expect(page.hasMore).toBe(false)
    expect(page.comments.map((c) => c.id)).toEqual([second.id, first.body.id])
    expect((await client.get(`/api/cards/${card}`)).body).toMatchObject({ commentCount: 2, comments: 2 })

    const edited = await client.patch(`/api/comments/${second.id}`, { body: 'Hecho: firmado por las dos partes.' })
    expect(edited.status).toBe(200)
    expect(edited.body.editedAt).not.toBeNull()
    // Saving the same text again changes nothing.
    const same = await client.patch(`/api/comments/${second.id}`, { body: 'Hecho: firmado por las dos partes.' })
    expect(same.body.editedAt).toBe(edited.body.editedAt)

    const removed = await client.del(`/api/comments/${first.body.id}`)
    expect(removed.status).toBe(200)
    expect((await comments(client, card)).comments.map((c) => c.id)).toEqual([second.id])
    const trash = (await client.get(`/api/workspaces/${workspaceId}/trash`)).body as TrashNodeDTO[]
    // In a line, without its Markdown, and where it goes back: its card.
    expect(trash.find((e) => e.trashId === removed.body.trashId)).toMatchObject({ kind: 'comment', title: 'Primero revisar la cláusula 4.', location: 'Lanzamiento › Producto › Contrato de alquiler' })

    expect((await client.post(`/api/trash/${removed.body.trashId}/restore`)).status).toBe(200)
    const back = await comments(client, card)
    expect(back.comments.map((c) => c.id)).toEqual([second.id, first.body.id])
    expect(back.comments[1]).toMatchObject({ body: '  Primero **revisar** la cláusula 4.', author: { kind: 'user', name: 'Ana López' }, canEdit: true })

    const kinds = (await historyOf(client, card)).map((e) => e.kind)
    expect(kinds).toEqual(expect.arrayContaining(['comment.created', 'comment.body', 'comment.deleted', 'comment.restored']))
    const body = (await historyOf(client, card)).find((e) => e.kind === 'comment.body')!
    expect(body).toMatchObject({ subjectId: second.id, before: 'Hecho: firmado.', after: 'Hecho: firmado por las dos partes.' })
  })

  it('refuses an empty comment and one over the limit, counting an emoji as one character', async () => {
    const { client, card } = await setup()
    for (const body of ['', '   \n\t', '​']) expect((await client.post(`/api/cards/${card}/comments`, { body })).status).toBe(400)
    const longest = `${'a'.repeat(MAX_COMMENT - 1)}🦤`
    expect(longest.length).toBe(MAX_COMMENT + 1)
    expect((await client.post(`/api/cards/${card}/comments`, { body: longest })).status).toBe(201)
    expect((await client.post(`/api/cards/${card}/comments`, { body: `${longest}!` })).status).toBe(400)
    expect((await comments(client, card)).total).toBe(1)
  })

  it('pages through many comments, also from one comment on, and through a card of another workspace not at all', async () => {
    const { client, card } = await setup()
    for (let i = 1; i <= 55; i++) expect((await client.post(`/api/cards/${card}/comments`, { body: `Nota ${i}` })).status).toBe(201)
    const first = await comments(client, card)
    expect(first).toMatchObject({ total: 55, hasMore: true })
    expect(first.comments).toHaveLength(50)
    const last = first.comments.at(-1)!
    const rest = await comments(client, card, `?before=${encodeURIComponent(last.createdAt)}&beforeId=${last.id}`)
    expect(rest.hasMore).toBe(false)
    expect([...first.comments, ...rest.comments].map((c) => c.body).sort()).toEqual(Array.from({ length: 55 }, (_, i) => `Nota ${i + 1}`).sort())
    expect(new Set([...first.comments, ...rest.comments].map((c) => c.id)).size).toBe(55)
    expect((await comments(client, card, `?beforeId=${last.id}&limit=3`)).comments.map((c) => c.id)).toEqual(rest.comments.slice(0, 3).map((c) => c.id))

    const stranger = await signUp(h, 'Otra persona')
    expect((await stranger.client.get(`/api/cards/${card}/comments`)).status).toBe(404)
    expect((await stranger.client.post(`/api/cards/${card}/comments`, { body: 'Hola' })).status).toBe(404)
    expect((await stranger.client.del(`/api/comments/${last.id}`)).status).toBe(404)
  })

  it('lets an agent comment over MCP, read and page them, and change or delete only its own', async () => {
    const { client, card, workspaceId } = await setup()
    const mine = (await client.post(`/api/cards/${card}/comments`, { body: 'Comentario de la persona' })).body as CommentDTO
    const events: RealtimeEvent[] = []
    const stop = h.bus.subscribe(workspaceId, (e) => events.push(e))
    const agent = await connect((await token(client, workspaceId, ['tasks:read', 'tasks:write', 'organize'])).token)

    const added = data(await agent.callTool({ name: 'add_comment', arguments: { card_id: card, body: 'PR abierta: **#12**' } }))
    expect(added.created).toBe(true)
    expect(events.at(-1)).toMatchObject({ action: 'card.commented', cardId: card, actor: { kind: 'agent', name: 'Claude' } })

    const got = data(await agent.callTool({ name: 'get_card', arguments: { card_id: card } }))
    expect(got.comments).toMatchObject({ total: 2, more: false })
    expect(got.comments.latest[0]).toMatchObject({ id: added.comment_id, author: 'Claude', author_kind: 'agent', yours: true, body: 'PR abierta: **#12**', edited_at: null })
    expect(got.comments.latest[1]).toMatchObject({ id: mine.id, author_kind: 'user', yours: false })

    const updated = data(await agent.callTool({ name: 'update_comment', arguments: { comment_id: added.comment_id, body: 'PR fusionada: **#12**' } }))
    expect(updated.updated).toBe(true)
    expect(events.at(-1)).toMatchObject({ action: 'card.comment_edited', cardId: card })
    // Not the person's: neither changed nor deleted, and the comment stays as it was.
    const refused = await agent.callTool({ name: 'update_comment', arguments: { comment_id: mine.id, body: 'Cambiado por el agente' } })
    expect(failed(refused)).toBe(true)
    expect(text(refused)).toContain('Only the author')
    expect(failed(await agent.callTool({ name: 'delete_comment', arguments: { comment_id: mine.id } }))).toBe(true)
    expect((await comments(client, card)).comments.find((c) => c.id === mine.id)!.body).toBe('Comentario de la persona')

    // The person can't change the agent's words, but as the owner can delete them, to the trash.
    const agentsComment = (await comments(client, card)).comments.find((c) => c.id === added.comment_id)!
    expect(agentsComment).toMatchObject({ author: { kind: 'agent', name: 'Claude' }, canEdit: false, canDelete: true })
    expect((await client.patch(`/api/comments/${added.comment_id}`, { body: 'Cambiado' })).body.error.code).toBe('not_comment_author')

    const deleted = data(await agent.callTool({ name: 'delete_comment', arguments: { comment_id: added.comment_id } }))
    expect(deleted).toMatchObject({ deleted: true, trash_id: expect.any(String) })
    expect(events.at(-1)).toMatchObject({ action: 'card.comment_deleted', cardId: card })
    expect((await comments(client, card)).total).toBe(1)
    stop()

    // Paging over MCP, newest first.
    for (let i = 1; i <= 5; i++) await agent.callTool({ name: 'add_comment', arguments: { card_id: card, body: `Paso ${i}` } })
    const page = data(await agent.callTool({ name: 'list_comments', arguments: { card_id: card, limit: 3 } }))
    expect(page.total).toBe(6)
    expect(page.comments.map((c: { body: string }) => c.body)).toEqual(['Paso 5', 'Paso 4', 'Paso 3'])
    const next = data(await agent.callTool({ name: 'list_comments', arguments: { card_id: card, limit: 3, before: page.next_before } }))
    expect(next.comments.map((c: { body: string }) => c.body)).toEqual(['Paso 2', 'Paso 1', 'Comentario de la persona'])
    expect(next.next_before).toBeNull()
  })

  it('keeps an agent to its own access: another one cannot change its comments, nor one without leave to delete', async () => {
    const { client, card, workspaceId } = await setup()
    const first = await connect((await token(client, workspaceId, ['tasks:read', 'tasks:write'], 'Claude')).token)
    const other = await connect((await token(client, workspaceId, ['tasks:read', 'tasks:write', 'organize'], 'Claude')).token)
    const reader = await connect((await token(client, workspaceId, ['tasks:read'], 'Lector')).token)
    const id = data(await first.callTool({ name: 'add_comment', arguments: { card_id: card, body: 'Del primer acceso' } })).comment_id as string

    // Same name, another access: not its author.
    expect(failed(await other.callTool({ name: 'update_comment', arguments: { comment_id: id, body: 'Otro' } }))).toBe(true)
    expect(failed(await other.callTool({ name: 'delete_comment', arguments: { comment_id: id } }))).toBe(true)
    expect(data(await other.callTool({ name: 'get_card', arguments: { card_id: card } })).comments.latest[0].yours).toBe(false)
    // Without leave to delete, there is no tool for it; reading only, none to write.
    const firstTools = (await first.listTools()).tools.map((t) => t.name)
    expect(firstTools).toEqual(expect.arrayContaining(['add_comment', 'update_comment', 'list_comments']))
    expect(firstTools).not.toContain('delete_comment')
    const readerTools = (await reader.listTools()).tools.map((t) => t.name)
    expect(readerTools).toContain('list_comments')
    expect(readerTools).not.toContain('add_comment')
    expect(data(await reader.callTool({ name: 'list_comments', arguments: { card_id: card } })).comments[0].body).toBe('Del primer acceso')
  })

  it('keeps the comments of an access that is revoked, with its name: nobody can change them, the owner can delete them', async () => {
    const { client, card, workspaceId } = await setup()
    const access = await token(client, workspaceId, ['tasks:read', 'tasks:write'], 'Asistente de Trello')
    const bot = new Client(h, access.token)
    const id = (await bot.post(`/api/cards/${card}/comments`, { body: 'Copiado de Trello' })).body.id as string
    expect((await client.del(`/api/tokens/${access.id}`)).status).toBeLessThan(300)
    expect((await bot.patch(`/api/comments/${id}`, { body: 'Otra vez' })).status).toBe(401)
    const [kept] = (await comments(client, card)).comments
    expect(kept).toMatchObject({ id, body: 'Copiado de Trello', author: { kind: 'agent', name: 'Asistente de Trello' }, canEdit: false, canDelete: true })
    expect((await client.del(`/api/comments/${id}`)).status).toBe(200)
  })

  it('goes to the trash and comes back with its card, column and board, also 150 of them', async () => {
    const { client, card, workspaceId, columns, boardId } = await setup()
    for (let i = 1; i <= 150; i++) expect((await client.post(`/api/cards/${card}/comments`, { body: `Comentario ${i}` })).status).toBe(201)
    const bodies = () => allBodies(client, card)

    const cardTrash = (await client.del(`/api/cards/${card}`)).body.trashId as string
    expect((await client.get(`/api/cards/${card}/comments`)).status).toBe(404)
    const trash = (await client.get(`/api/workspaces/${workspaceId}/trash`)).body as TrashNodeDTO[]
    expect(trash.find((e) => e.trashId === cardTrash)!.contents).toMatchObject({ comments: 150 })
    expect((await client.post(`/api/trash/${cardTrash}/restore`)).status).toBe(200)
    expect(await bodies()).toHaveLength(150)

    const columnTrash = (await client.del(`/api/columns/${columns[0]!.id}`)).body.trashId as string
    expect((await client.post(`/api/trash/${columnTrash}/restore`)).status).toBe(200)
    expect(await bodies()).toHaveLength(150)

    const boardTrash = (await client.del(`/api/boards/${boardId}`)).body.trashId as string
    expect((await client.post(`/api/trash/${boardTrash}/restore`)).status).toBe(200)
    const all = await allBodies(client, card)
    expect(all.sort()).toEqual(Array.from({ length: 150 }, (_, i) => `Comentario ${i + 1}`).sort())
  })

  it('shows in the trash tree under its card, comes back with it, or goes to another card', async () => {
    const { client, card, workspaceId, columns } = await setup()
    const id = (await client.post(`/api/cards/${card}/comments`, { body: 'Una nota *suelta*' })).body.id as string
    const commentTrash = (await client.del(`/api/comments/${id}`)).body.trashId as string
    const cardTrash = (await client.del(`/api/cards/${card}`)).body.trashId as string
    // Under its card, which went to the trash after it, as deleted before on its own.
    const tree = (await client.get(`/api/workspaces/${workspaceId}/trash/card:${card}`)).body as TrashTreeDTO
    expect(tree.node.contents).toMatchObject({ comments: 1 })
    expect(tree.below.map((n) => [n.kind, n.title, n.earlier])).toEqual([['comment', 'Una nota suelta', true]])
    // Its card is in the trash: restoring it alone says so.
    expect((await client.post(`/api/trash/${commentTrash}/restore`)).body.error.code).toBe('restore_place_in_trash')

    // Another card instead.
    const other = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Otra tarjeta' })).body.id as string
    const restored = await client.post(`/api/workspaces/${workspaceId}/trash/restore`, { key: `comment:${id}`, to: { kind: 'other', parent: { kind: 'card', id: other } } })
    expect(restored.status, JSON.stringify(restored.body)).toBe(200)
    expect((await comments(client, other)).comments.map((c) => c.body)).toEqual(['Una nota *suelta*'])
    // Its card comes back without it now, and it is in the history of the card it went to.
    expect((await client.post(`/api/trash/${cardTrash}/restore`)).status).toBe(200)
    expect((await comments(client, card)).total).toBe(0)
    expect((await historyOf(client, other)).map((e) => e.kind)).toContain('comment.restored')
  })

  it('undoes what an agent wrote, changed and deleted, also all at once', async () => {
    const { client, card, workspaceId } = await setup()
    const bot = new Client(h, (await token(client, workspaceId, ['tasks:read', 'tasks:write', 'organize'], 'Asistente')).token)
    const kept = (await bot.post(`/api/cards/${card}/comments`, { body: 'Primera versión' })).body.id as string
    await bot.patch(`/api/comments/${kept}`, { body: 'Segunda versión' })
    const gone = (await bot.post(`/api/cards/${card}/comments`, { body: 'Para borrar' })).body.id as string
    await bot.del(`/api/comments/${gone}`)

    const entries = await historyOf(client, card)
    const undo = async (body: Record<string, unknown>) => {
      const res = await client.post('/api/history/undo', body)
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      return res.body as UndoResultDTO
    }
    // The edit, on its own: the agent's earlier words come back, still the agent's.
    const edit = entries.find((e) => e.kind === 'comment.body')!
    expect((await undo({ ids: [edit.id] })).undone).toBe(1)
    expect((await comments(client, card)).comments.find((c) => c.id === kept)).toMatchObject({ body: 'Primera versión', author: { kind: 'agent', name: 'Asistente' } })
    // The deletion: it comes back.
    expect((await undo({ ids: [entries.find((e) => e.kind === 'comment.deleted')!.id] })).undone).toBe(1)
    expect((await comments(client, card)).comments.map((c) => c.id)).toContain(gone)

    // Everything the agent did, from its first change on: no comment of its is left.
    const first = (await historyOf(client, card)).filter((e) => e.actor.kind === 'agent').at(-1)!
    const all = await undo({ since: first.id, conflicts: 'force' })
    expect(all.failed).toBe(0)
    expect((await comments(client, card)).total).toBe(0)
  })

  it('is found by search, with which comment matched, and leaves out archived cards unless asked', async () => {
    const { client, card, workspaceId, columns } = await setup()
    await client.post(`/api/cards/${card}/comments`, { body: 'Llamar al **fontanero** el lunes' })
    // A card whose own text matches comes first, and once.
    const titled = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Fontanero de urgencia' })).body.id as string
    await client.post(`/api/cards/${titled}/comments`, { body: 'El fontanero no vino' })

    const results = (await client.get(`/api/workspaces/${workspaceId}/search?q=fontanero`)).body as Array<{ id: string; excerpt: string; comment?: { author: string } }>
    expect(results.map((r) => r.id)).toEqual([titled, card])
    expect(results[0]!.comment).toBeUndefined()
    expect(results[1]).toMatchObject({ comment: { author: 'Ana López' }, excerpt: 'Llamar al fontanero el lunes' })

    await client.post(`/api/cards/${card}/archive`)
    expect(((await client.get(`/api/workspaces/${workspaceId}/search?q=lunes`)).body as unknown[]).length).toBe(0)
    expect((await client.get(`/api/workspaces/${workspaceId}/search?q=lunes&archived=1`)).body).toMatchObject([{ id: card, archived: true }])
  })

  it('survives restoring a backup, and is found by search again', async () => {
    // A copy of its own: restoring replaces everything in it.
    const own = await createHarness()
    try {
      const { client, workspaceId, accessKey } = await signUp(own)
      const { columns } = await seedBoard(client, workspaceId)
      const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Mudanza' })).body.id as string
      const kept = (await client.post(`/api/cards/${card}/comments`, { body: 'Presupuesto de la **furgoneta**' })).body.id as string
      const made = await client.post('/api/backups')
      expect(made.status).toBe(201)
      await client.patch(`/api/comments/${kept}`, { body: 'Cambiado después' })
      await client.post(`/api/cards/${card}/comments`, { body: 'Escrito después' })

      const restored = await client.post(`/api/backups/${made.body.id}/restore`, { accessKey })
      expect(restored.status, JSON.stringify(restored.body)).toBe(200)
      expect((await comments(client, card)).comments).toMatchObject([{ id: kept, body: 'Presupuesto de la **furgoneta**', editedAt: null }])
      expect((await client.get(`/api/workspaces/${workspaceId}/search?q=furgoneta`)).body).toMatchObject([{ id: card, comment: { id: kept } }])
      expect((await client.get(`/api/workspaces/${workspaceId}/search?q=despues`)).body).toEqual([])
    } finally {
      await own.close()
    }
  })

  it('is in the readable export, oldest first, with who wrote it', async () => {
    const { client, card, workspaceId } = await setup()
    await client.post(`/api/cards/${card}/comments`, { body: 'Primero' })
    const bot = new Client(h, (await token(client, workspaceId, ['tasks:read', 'tasks:write'], 'Asistente')).token)
    await bot.post(`/api/cards/${card}/comments`, { body: `Segundo, con [enlace](/card/${card})` })

    const res = await h.app.request('/api/export', { headers: { Cookie: client.cookie, Origin: ORIGIN } })
    expect(res.status).toBe(200)
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
    const name = Object.keys(files).find((f) => f.endsWith('/tasks.json') && strFromU8(files[f]!).includes(card))!
    const tasks = JSON.parse(strFromU8(files[name]!))
    const exported = tasks.projects.flatMap((p: any) => p.boards.flatMap((b: any) => b.columns.flatMap((c: any) => c.cards))).find((c: any) => c.id === card)
    expect(exported.comments).toMatchObject([
      { author: 'Ana López', by: 'person', body: 'Primero', editedAt: null },
      { author: 'Asistente', by: 'agent', body: `Segundo, con [enlace](tasks.json#${card})` },
    ])
  })
})

/** Every comment of a card, page after page. */
async function allBodies(client: Client, card: string) {
  const out: string[] = []
  let query = ''
  for (;;) {
    const page = await comments(client, card, query)
    out.push(...page.comments.map((c) => c.body))
    if (!page.hasMore) return out
    const last = page.comments.at(-1)!
    query = `?before=${encodeURIComponent(last.createdAt)}&beforeId=${last.id}`
  }
}
