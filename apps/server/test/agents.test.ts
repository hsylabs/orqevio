import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, type Harness, createHarness, seedBoard, signUp } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => h.close())

async function createToken(client: Client, workspaceId: string, scopes: string[], name = 'Claude') {
  const res = await client.post('/api/tokens', { name, workspaceId, scopes, expiresInDays: 30 })
  expect(res.status).toBe(201)
  return res.body as { id: string; token: string; scopes: string[] }
}

async function connect(token: string) {
  const client = new McpClient({ name: 'test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost:3000/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: async (url, init) => h.app.request(String(url), init as RequestInit),
  })
  await client.connect(transport)
  return client
}

const text = (result: unknown) => {
  const r = result as { content: Array<{ type: string; text: string }> }
  return r.content[0]!.text
}
const data = (result: unknown) => JSON.parse(text(result))

describe('agent tokens', () => {
  it('stores only a hash, returns the token once and expands write to read', async () => {
    const { client, workspaceId } = await signUp(h)
    const token = await createToken(client, workspaceId, ['docs:write'])
    expect(token.token).toMatch(/^orq_/)
    expect(token.scopes.sort()).toEqual(['docs:read', 'docs:write'])
    const list = await client.get('/api/tokens')
    expect(list.body[0]).not.toHaveProperty('token')
    expect(list.body[0].prefix).toBe(token.token.slice(0, 12))
  })

  it('enforces scopes on the shared REST API', async () => {
    const { client, workspaceId } = await signUp(h)
    const { boardId, columns } = await seedBoard(client, workspaceId)
    const reader = new Client(h, (await createToken(client, workspaceId, ['tasks:read'])).token)
    expect((await reader.get(`/api/boards/${boardId}`)).status).toBe(200)
    const denied = await reader.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Nope' })
    expect(denied.status).toBe(403)
    expect(denied.body.error.code).toBe('missing_scope')
    // Token management and account endpoints are session-only.
    expect((await reader.get('/api/tokens')).status).toBe(403)
    expect((await reader.get('/api/auth/me')).status).toBe(403)
  })

  it("can't delete labels, checklists, their items or card links, which people can, and logs it", async () => {
    const { client, workspaceId } = await signUp(h)
    const { projectId, boardId, columns } = await seedBoard(client, workspaceId)
    const agent = new Client(h, (await createToken(client, workspaceId, ['tasks:write', 'docs:write'])).token)
    const card = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Con todo' })
    const label = await agent.post(`/api/boards/${boardId}/labels`, { name: 'Urgente', color: 'tomato' })
    expect(label.status).toBe(201)
    expect((await agent.patch(`/api/labels/${label.body.id}`, { name: 'Muy urgente' })).status).toBe(200)
    const checklist = await agent.post(`/api/cards/${card.body.id}/checklists`, { title: 'Pasos' })
    const item = await agent.post(`/api/checklists/${checklist.body.id}/items`, { text: 'Primero' })
    const page = await client.post(`/api/projects/${projectId}/pages`, { title: 'Notas' })
    expect((await agent.post(`/api/cards/${card.body.id}/pages`, { pageId: page.body.id })).status).toBe(204)

    for (const url of [
      `/api/labels/${label.body.id}`,
      `/api/checklists/${checklist.body.id}`,
      `/api/checklist-items/${item.body.id}`,
      `/api/cards/${card.body.id}/pages/${page.body.id}`,
    ]) {
      const denied = await agent.del(url)
      expect(denied.status, url).toBe(403)
      expect(denied.body.error.code, url).toBe('session_required')
    }
    const kept = await client.get(`/api/cards/${card.body.id}`)
    expect(kept.body.checklists[0].items).toHaveLength(1)
    expect(kept.body.pages.map((p: { id: string }) => p.id)).toEqual([page.body.id])
    expect((await client.get(`/api/boards/${boardId}`)).body.labels).toHaveLength(1)

    // People still can, and every change to labels and links shows in the activity.
    expect((await client.del(`/api/cards/${card.body.id}/pages/${page.body.id}`)).status).toBe(200)
    expect((await client.del(`/api/checklist-items/${item.body.id}`)).status).toBe(200)
    expect((await client.del(`/api/checklists/${checklist.body.id}`)).status).toBe(200)
    expect((await client.del(`/api/labels/${label.body.id}`)).status).toBe(200)
    const activity = (await client.get(`/api/workspaces/${workspaceId}/activity`)).body as Array<{ action: string; summary: string; actor: { kind: string } }>
    const entry = (action: string) => activity.find((a) => a.action === action)
    expect(entry('label.created')).toMatchObject({ summary: 'Urgente', actor: { kind: 'agent' } })
    expect(entry('label.updated')).toMatchObject({ summary: 'Muy urgente', actor: { kind: 'agent' } })
    expect(entry('label.deleted')).toMatchObject({ summary: 'Muy urgente', actor: { kind: 'user' } })
    expect(entry('card.unlinked')).toMatchObject({ summary: 'Con todo', meta: { page: 'Notas' } })
    // Removing a link that is no longer there changes nothing, puts nothing in the trash and logs nothing.
    expect((await client.del(`/api/cards/${card.body.id}/pages/${page.body.id}`)).body).toEqual({ trashId: null })
    const again = (await client.get(`/api/workspaces/${workspaceId}/activity`)).body as Array<{ action: string }>
    expect(again.filter((a) => a.action === 'card.unlinked')).toHaveLength(1)
  })

  it('binds tokens to one workspace and honours revocation', async () => {
    const a = await signUp(h)
    const extra = await a.client.post('/api/workspaces', { name: 'Otro espacio' })
    const other = await seedBoard(a.client, extra.body.id)
    const token = await createToken(a.client, a.workspaceId, ['tasks:read', 'tasks:write'])
    const agent = new Client(h, token.token)
    expect((await agent.get(`/api/boards/${other.boardId}`)).status).toBe(404)
    expect((await agent.get('/api/workspaces')).body.map((w: { id: string }) => w.id)).toEqual([a.workspaceId])
    expect((await a.client.del(`/api/tokens/${token.id}`)).status).toBe(204)
    const revoked = await agent.get('/api/workspaces')
    expect(revoked.status).toBe(401)
    expect(revoked.body.error.code).toBe('invalid_token')
  })
})

describe('MCP server', () => {
  it('rejects requests without a valid token', async () => {
    const res = await h.app.request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('Bearer')
  })

  it('exposes only the tools allowed by the token and never vault tools', async () => {
    const { client, workspaceId } = await signUp(h)
    const docsOnly = await connect((await createToken(client, workspaceId, ['docs:read'])).token)
    const names = (await docsOnly.listTools()).tools.map((t) => t.name).sort()
    expect(names).toEqual(['list_pages', 'list_projects', 'read_page', 'search'])

    const full = await connect((await createToken(client, workspaceId, ['tasks:write', 'docs:write'])).token)
    const all = (await full.listTools()).tools.map((t) => t.name)
    expect(all).toEqual(expect.arrayContaining(['create_card', 'move_card', 'create_page', 'update_page', 'link_card_to_page']))
    expect(all.some((n) => /vault|password|secret|credential/i.test(n))).toBe(false)
    expect(all).not.toContain('delete_card')
    expect(all).toContain('create_project')
    expect(all).not.toContain('update_project')
    const instructions = full.getInstructions() ?? ''
    expect(instructions).toContain('never accessible')
  })

  it('lets an agent organise a board and document it through the shared services', async () => {
    const { client, workspaceId } = await signUp(h)
    const { projectId, boardId, columns } = await seedBoard(client, workspaceId)
    const token = await createToken(client, workspaceId, ['tasks:write', 'docs:write'], 'Agente de prueba')
    const mcp = await connect(token.token)

    const projects = data(await mcp.callTool({ name: 'list_projects', arguments: {} }))
    expect(projects.projects[0].boards[0].id).toBe(boardId)

    const created = data(
      await mcp.callTool({
        name: 'create_card',
        arguments: { column_id: columns[0]!.id, title: 'Revisar contratos', due_date: '2026-12-15', description: '- [ ] Proveedor A' },
      }),
    )
    expect(created.created).toBe(true)
    const openCards = async () => {
      const listed = data(await mcp.callTool({ name: 'list_projects', arguments: {} }))
      return listed.projects.flatMap((p: { boards: Array<{ id: string; open_cards: number }> }) => p.boards).find((b: { id: string }) => b.id === boardId).open_cards
    }
    expect(await openCards()).toBe(1)
    await mcp.callTool({ name: 'move_card', arguments: { card_id: created.card_id, column_id: columns[1]!.id, index: 0 } })
    const items = data(await mcp.callTool({ name: 'add_checklist_items', arguments: { card_id: created.card_id, items: ['Leer', 'Firmar'] } }))
    await mcp.callTool({ name: 'update_checklist_item', arguments: { item_id: items.items[0].id, done: true } })

    const board = data(await mcp.callTool({ name: 'get_board', arguments: { board_id: boardId } }))
    const inProgress = board.columns.find((c: { id: string }) => c.id === columns[1]!.id)
    expect(inProgress.cards[0]).toMatchObject({ title: 'Revisar contratos', checklist: '1/2', due: '2026-12-15T12:00:00.000Z' })

    const page = data(
      await mcp.callTool({
        name: 'create_page',
        arguments: { project_id: projectId, title: 'Contratos', content: `Seguimiento en [Revisar contratos](/card/${created.card_id}).` },
      }),
    )
    // Card descriptions carry a version too: an edit from an old one is refused.
    const fetched = data(await mcp.callTool({ name: 'get_card', arguments: { card_id: created.card_id } }))
    expect(fetched.version).toBe(1)
    const described = data(await mcp.callTool({ name: 'update_card', arguments: { card_id: created.card_id, description: 'Plazo: viernes', base_version: 1 } }))
    expect(described.version).toBe(2)
    const stale = await mcp.callTool({ name: 'update_card', arguments: { card_id: created.card_id, description: 'Pisada', base_version: 1 } })
    expect(stale.isError).toBe(true)
    expect(data(await mcp.callTool({ name: 'get_card', arguments: { card_id: created.card_id } }))).toMatchObject({ description: 'Plazo: viernes', version: 2 })

    const appended = data(await mcp.callTool({ name: 'update_page', arguments: { page_id: page.page_id, content: '## Anexo', mode: 'append' } }))
    expect(appended.version).toBe(2)
    const conflict = await mcp.callTool({ name: 'update_page', arguments: { page_id: page.page_id, content: 'x', base_version: 1 } })
    expect(conflict.isError).toBe(true)
    const read = text(await mcp.callTool({ name: 'read_page', arguments: { page_id: page.page_id } }))
    expect(read).toContain('version: 2')
    expect(read).toContain('## Anexo')

    // The person sees the agent's work, attributed to the token.
    const card = await client.get(`/api/cards/${created.card_id}`)
    expect(card.body.createdBy).toEqual({ kind: 'agent', id: token.id, name: 'Agente de prueba' })
    expect(card.body.pages.map((p: { id: string }) => p.id)).toEqual([page.page_id])
    const activity = await client.get(`/api/workspaces/${workspaceId}/activity?agents=1`)
    expect(activity.body.map((a: { action: string }) => a.action)).toEqual(
      expect.arrayContaining(['card.created', 'card.moved', 'page.created', 'page.updated']),
    )

    // Agents cannot delete: there is no such tool, and the REST route refuses tokens.
    const rest = new Client(h, token.token)
    expect((await rest.del(`/api/cards/${created.card_id}`)).status).toBe(403)
    const archived = data(await mcp.callTool({ name: 'archive_card', arguments: { card_id: created.card_id } }))
    expect(archived.archived).toBe(true)
    expect(await openCards()).toBe(0)
  })

  it('lets an agent with write access start a project in an empty workspace, but not rename it', async () => {
    const { client } = await signUp(h)
    const empty = await client.post('/api/workspaces', { name: 'Vacío' })
    expect(empty.status).toBe(201)

    // A read-only agent learns why it can't start, instead of an empty list without a word.
    const reader = await connect((await createToken(client, empty.body.id, ['tasks:read', 'docs:read'])).token)
    expect((await reader.listTools()).tools.map((t) => t.name)).not.toContain('create_project')
    const nothing = data(await reader.callTool({ name: 'list_projects', arguments: {} }))
    expect(nothing.projects).toEqual([])
    expect(nothing.hint).toContain('Ask the person')

    const token = await createToken(client, empty.body.id, ['docs:write'], 'Redactor')
    const writer = await connect(token.token)
    expect(data(await writer.callTool({ name: 'list_projects', arguments: {} })).hint).toContain('create_project')
    const created = data(await writer.callTool({ name: 'create_project', arguments: { name: 'Manual', description: 'Guías de uso', color: 'jade' } }))
    expect(created).toMatchObject({ created: true, name: 'Manual' })
    const listed = data(await writer.callTool({ name: 'list_projects', arguments: {} }))
    expect(listed.hint).toBeUndefined()
    expect(listed.projects).toEqual([{ id: created.project_id, name: 'Manual', description: 'Guías de uso', pages: [] }])
    const page = data(await writer.callTool({ name: 'create_page', arguments: { project_id: created.project_id, title: 'Primeros pasos' } }))
    expect(page.created).toBe(true)

    // The person sees who created it; renaming and deleting stay in the app.
    const activity = await client.get(`/api/workspaces/${empty.body.id}/activity?agents=1`)
    expect(activity.body.find((a: { action: string }) => a.action === 'project.created')).toMatchObject({ summary: 'Manual' })
    const rest = new Client(h, token.token)
    expect((await rest.patch(`/api/projects/${created.project_id}`, { name: 'Otro' })).status).toBe(403)
    expect((await rest.del(`/api/projects/${created.project_id}`)).status).toBe(403)
  })

  it('reports permission errors as tool errors', async () => {
    const { client, workspaceId } = await signUp(h)
    const { columns } = await seedBoard(client, workspaceId)
    const stranger = await signUp(h)
    const mcp = await connect((await createToken(stranger.client, stranger.workspaceId, ['tasks:write'])).token)
    const res = await mcp.callTool({ name: 'create_card', arguments: { column_id: columns[0]!.id, title: 'Intrusión' } })
    expect(res.isError).toBe(true)
    expect(text(res)).toMatch(/not found/i)
  })
})

describe('realtime', () => {
  it('broadcasts agent changes to workspace subscribers', async () => {
    const { client, workspaceId } = await signUp(h)
    const { columns } = await seedBoard(client, workspaceId)
    const received: Array<{ action: string; actor: { kind: string } }> = []
    const unsubscribe = h.bus.subscribe(workspaceId, (e) => received.push(e))
    const mcp = await connect((await createToken(client, workspaceId, ['tasks:write'])).token)
    await mcp.callTool({ name: 'create_card', arguments: { column_id: columns[0]!.id, title: 'En directo' } })
    await new Promise((r) => setTimeout(r, 300))
    unsubscribe()
    expect(received).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'card.created', actor: expect.objectContaining({ kind: 'agent' }) })]))
  })
})
