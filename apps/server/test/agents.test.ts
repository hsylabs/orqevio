import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { VERSION } from '../src/version'
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

  it('tells MCP clients the version of this copy', async () => {
    const { client, workspaceId } = await signUp(h, 'Versión')
    const { token } = await createToken(client, workspaceId, ['tasks:read'])
    expect((await connect(token)).getServerVersion()).toMatchObject({ name: 'orqevio', version: VERSION })
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

  it('deletes to the trash only with permission to delete and move, and people bring it back', async () => {
    const { client, workspaceId } = await signUp(h)
    const { projectId, boardId, columns } = await seedBoard(client, workspaceId)
    const card = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Con todo' })
    const writer = new Client(h, (await createToken(client, workspaceId, ['tasks:write', 'docs:write'])).token)
    const organizer = new Client(h, (await createToken(client, workspaceId, ['tasks:write', 'docs:write', 'organize'], 'Ordenador')).token)
    const label = await writer.post(`/api/boards/${boardId}/labels`, { name: 'Urgente', color: 'tomato' })
    expect(label.status).toBe(201)
    expect((await writer.patch(`/api/labels/${label.body.id}`, { name: 'Muy urgente' })).status).toBe(200)
    const checklist = await writer.post(`/api/cards/${card.body.id}/checklists`, { title: 'Pasos' })
    const item = await writer.post(`/api/checklists/${checklist.body.id}/items`, { text: 'Primero' })
    const page = await client.post(`/api/projects/${projectId}/pages`, { title: 'Notas' })
    expect((await writer.post(`/api/cards/${card.body.id}/pages`, { pageId: page.body.id })).status).toBe(204)
    const file = await client.upload(`/api/cards/${card.body.id}/attachments`, 'hola', { name: 'nota.txt', type: 'text/plain' })
    expect(file.status).toBe(201)

    const urls = [
      `/api/cards/${card.body.id}/pages/${page.body.id}`,
      `/api/checklist-items/${item.body.id}`,
      `/api/checklists/${checklist.body.id}`,
      `/api/labels/${label.body.id}`,
      `/api/attachments/${file.body.id}`,
    ]
    // Without the permission, nothing goes.
    for (const url of urls) {
      const denied = await writer.del(url)
      expect(denied.status, url).toBe(403)
      expect(denied.body.error.code, url).toBe('missing_scope')
    }
    const kept = await client.get(`/api/cards/${card.body.id}`)
    expect(kept.body.checklists[0].items).toHaveLength(1)
    expect(kept.body.pages.map((p: { id: string }) => p.id)).toEqual([page.body.id])
    expect(kept.body.attachmentList).toHaveLength(1)

    // With it, each goes to the trash, attributed to the agent.
    for (const url of urls) {
      const done = await organizer.del(url)
      expect(done.status, url).toBe(200)
      expect(done.body.trashId, url).toEqual(expect.any(String))
    }
    const emptied = await client.get(`/api/cards/${card.body.id}`)
    expect(emptied.body).toMatchObject({ checklists: [], pages: [], labels: [], attachmentList: [] })
    const activity = (await client.get(`/api/workspaces/${workspaceId}/activity`)).body as Array<{ action: string; summary: string; actor: { kind: string; name: string } }>
    const entry = (action: string) => activity.find((a) => a.action === action)
    expect(entry('label.created')).toMatchObject({ summary: 'Urgente', actor: { kind: 'agent' } })
    expect(entry('label.deleted')).toMatchObject({ summary: 'Muy urgente', actor: { kind: 'agent', name: 'Ordenador' } })
    expect(entry('card.unlinked')).toMatchObject({ summary: 'Con todo', meta: { page: 'Notas' }, actor: { kind: 'agent' } })

    // Only people see the trash and bring things back.
    expect((await organizer.get(`/api/workspaces/${workspaceId}/trash`)).status).toBe(403)
    const trash = (await client.get(`/api/workspaces/${workspaceId}/trash`)).body as Array<{ id: string; kind: string }>
    expect(trash.map((t) => t.kind).sort()).toEqual(['attachment', 'checklist', 'checklist_item', 'label', 'link'])
    expect((await organizer.post(`/api/trash/${trash[0]!.id}/restore`)).status).toBe(403)
    expect((await organizer.del(`/api/trash/${trash[0]!.id}`)).status).toBe(403)
    for (const entry of trash) expect((await client.post(`/api/trash/${entry.id}/restore`)).status).toBe(200)
    const back = await client.get(`/api/cards/${card.body.id}`)
    expect(back.body.checklists[0].items).toHaveLength(1)
    expect(back.body.pages.map((p: { id: string }) => p.id)).toEqual([page.body.id])
    expect((await client.get(`/api/boards/${boardId}`)).body.labels.map((l: { name: string }) => l.name)).toEqual(['Muy urgente'])
    expect(back.body.attachmentList.map((a: { filename: string }) => a.filename)).toEqual(['nota.txt'])

    // Removing a link that is no longer there changes nothing, puts nothing in the trash and logs nothing.
    expect((await client.del(`/api/cards/${card.body.id}/pages/${page.body.id}`)).status).toBe(200)
    expect((await client.del(`/api/cards/${card.body.id}/pages/${page.body.id}`)).body).toEqual({ trashId: null })
    const again = (await client.get(`/api/workspaces/${workspaceId}/activity`)).body as Array<{ action: string }>
    expect(again.filter((a) => a.action === 'card.unlinked')).toHaveLength(2)
  })

  it('lets an agent allowed to delete and move reorganise a project, but never what only people do', async () => {
    const { client, workspaceId } = await signUp(h)
    const { projectId, boardId, columns } = await seedBoard(client, workspaceId)
    const other = await seedBoard(client, workspaceId)
    const card = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Viajera' })
    const page = await client.post(`/api/projects/${projectId}/pages`, { title: 'Arriba' })
    const child = await client.post(`/api/projects/${projectId}/pages`, { title: 'Hija' })
    const file = await client.upload(`/api/cards/${card.body.id}/attachments`, 'datos', { name: 'datos.csv', type: 'text/csv' })
    const writer = new Client(h, (await createToken(client, workspaceId, ['tasks:write', 'docs:write'])).token)
    const tasksOnly = new Client(h, (await createToken(client, workspaceId, ['tasks:write', 'organize'])).token)
    const organizer = new Client(h, (await createToken(client, workspaceId, ['tasks:write', 'docs:write', 'organize'])).token)

    // Moving within a board or a project needs only write access, as before.
    expect((await writer.post(`/api/cards/${card.body.id}/move`, { columnId: columns[1]!.id, index: 0 })).status).toBe(200)
    expect((await writer.post(`/api/pages/${child.body.id}/move`, { parentId: page.body.id, index: 0 })).status).toBe(204)
    // To another board, or a file elsewhere, needs the permission, and write access on both sides.
    const across = await writer.post(`/api/cards/${card.body.id}/move`, { columnId: other.columns[0]!.id, index: 0 })
    expect(across.status).toBe(403)
    expect(across.body.error.code).toBe('missing_scope')
    expect((await writer.post(`/api/attachments/${file.body.id}/move`, { pageId: page.body.id })).status).toBe(403)
    expect((await tasksOnly.post(`/api/attachments/${file.body.id}/move`, { pageId: page.body.id })).status).toBe(403)
    expect((await organizer.post(`/api/cards/${card.body.id}/move`, { columnId: other.columns[0]!.id, index: 0 })).status).toBe(200)
    const moved = await organizer.post(`/api/attachments/${file.body.id}/move`, { pageId: page.body.id })
    expect(moved.status).toBe(200)
    expect((await client.get(`/api/pages/${page.body.id}`)).body.attachments.map((a: { id: string }) => a.id)).toEqual([file.body.id])
    expect((await client.get(`/api/cards/${card.body.id}`)).body).toMatchObject({ board: { id: other.boardId }, attachmentList: [] })
    // Reading a file takes read access to where it is now.
    expect((await tasksOnly.get(`/api/attachments/${file.body.id}`)).status).toBe(403)
    expect((await organizer.get(`/api/attachments/${file.body.id}`)).status).toBe(200)

    // Removing a link between a card and a page takes reading both, as making one does.
    const linked = await client.post(`/api/projects/${projectId}/pages`, { title: 'Enlazada' })
    expect((await client.post(`/api/cards/${card.body.id}/pages`, { pageId: linked.body.id })).status).toBe(204)
    expect((await tasksOnly.del(`/api/cards/${card.body.id}/pages/${linked.body.id}`)).status).toBe(403)
    expect((await organizer.del(`/api/cards/${card.body.id}/pages/${linked.body.id}`)).status).toBe(200)

    // Deleting a project takes write access to both its tasks and its documents.
    expect((await tasksOnly.del(`/api/projects/${projectId}`)).status).toBe(403)
    expect((await organizer.del(`/api/columns/${columns[2]!.id}`)).status).toBe(200)
    expect((await organizer.del(`/api/boards/${boardId}`)).status).toBe(200)
    expect((await organizer.del(`/api/pages/${child.body.id}`)).status).toBe(200)
    expect((await organizer.del(`/api/projects/${projectId}`)).status).toBe(200)

    // What only people do stays theirs: the workspace, the trash, the tokens, the account.
    expect((await organizer.del(`/api/workspaces/${workspaceId}`)).status).toBe(403)
    const trash = (await client.get(`/api/workspaces/${workspaceId}/trash`)).body as Array<{ id: string }>
    expect((await organizer.del(`/api/trash/${trash[0]!.id}`)).status).toBe(403)
    expect((await organizer.get('/api/tokens')).status).toBe(403)
    expect((await organizer.patch('/api/account', { name: 'Agente' })).status).toBe(403)
  })

  it('lets people turn deleting and moving on or off for a token, only theirs and only with write access', async () => {
    const { client, workspaceId } = await signUp(h)
    const { columns } = await seedBoard(client, workspaceId)
    const card = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Prueba' })
    // A token from before this permission existed.
    const old = await createToken(client, workspaceId, ['tasks:write'])
    expect(old.scopes).not.toContain('organize')
    const agent = new Client(h, old.token)
    expect((await agent.del(`/api/cards/${card.body.id}`)).status).toBe(403)

    const on = await client.patch(`/api/tokens/${old.id}`, { organize: true })
    expect(on.status).toBe(200)
    expect(on.body.scopes).toEqual(['tasks:read', 'tasks:write', 'organize'])
    const second = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Otra' })
    expect((await agent.del(`/api/cards/${second.body.id}`)).status).toBe(200)
    expect((await client.patch(`/api/tokens/${old.id}`, { organize: false })).body.scopes).toEqual(['tasks:read', 'tasks:write'])
    expect((await agent.del(`/api/cards/${card.body.id}`)).status).toBe(403)

    // Reading alone can't delete or move; asking for it at creation is dropped too.
    const reader = await createToken(client, workspaceId, ['tasks:read', 'organize'])
    expect(reader.scopes).toEqual(['tasks:read'])
    expect((await client.patch(`/api/tokens/${reader.id}`, { organize: true })).status).toBe(400)
    // Only its owner changes it, from the app.
    const stranger = await signUp(h, 'Otra Persona')
    expect((await stranger.client.patch(`/api/tokens/${old.id}`, { organize: true })).status).toBe(404)
    expect((await agent.patch(`/api/tokens/${old.id}`, { organize: true })).status).toBe(403)
    expect((await client.del(`/api/tokens/${old.id}`)).status).toBe(204)
    expect((await client.patch(`/api/tokens/${old.id}`, { organize: true })).status).toBe(404)
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
    expect(names).toEqual(['list_pages', 'list_projects', 'read_attachment', 'read_page', 'search'])

    const full = await connect((await createToken(client, workspaceId, ['tasks:write', 'docs:write'])).token)
    const all = (await full.listTools()).tools.map((t) => t.name)
    expect(all).toEqual(expect.arrayContaining(['create_card', 'move_card', 'create_page', 'update_page', 'link_card_to_page']))
    expect(all.some((n) => /vault|password|secret|credential/i.test(n))).toBe(false)
    expect(all).toEqual(expect.arrayContaining(['upload_attachment', 'read_attachment', 'move_page']))
    expect(all.filter((n) => n.startsWith('delete_') || n === 'move_attachment' || n === 'unlink_card_from_page')).toEqual([])
    expect(all).toContain('create_project')
    expect(all).not.toContain('update_project')
    const instructions = full.getInstructions() ?? ''
    expect(instructions).toContain('never accessible')

    // Allowed to delete and move: the tools to do it, marked as destructive, and never anything for good.
    const organizer = await connect((await createToken(client, workspaceId, ['tasks:write', 'docs:write', 'organize'])).token)
    const tools = (await organizer.listTools()).tools
    const deletes = tools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name).sort()
    expect(deletes).toEqual([
      'delete_attachment',
      'delete_board',
      'delete_card',
      'delete_checklist',
      'delete_checklist_item',
      'delete_column',
      'delete_label',
      'delete_page',
      'delete_project',
      'unlink_card_from_page',
    ])
    expect(tools.map((t) => t.name)).toContain('move_attachment')
    expect(tools.some((t) => /purge|empty|trash|workspace|token|account/i.test(t.name))).toBe(false)
    expect(organizer.getInstructions()).toContain('never empty the trash')
    // Tasks only: nothing that touches documents or a whole project.
    const tasksOnly = await connect((await createToken(client, workspaceId, ['tasks:write', 'organize'])).token)
    const names2 = (await tasksOnly.listTools()).tools.map((t) => t.name)
    expect(names2).toContain('delete_card')
    expect(names2).not.toContain('delete_page')
    expect(names2).not.toContain('delete_project')
    expect(names2).not.toContain('unlink_card_from_page')
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

    // Without permission to delete and move, there is no tool to delete, and the REST route refuses.
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

  it('lets an agent tidy up with tools that delete to the trash and move, and people undo it', async () => {
    const { client, workspaceId } = await signUp(h)
    const { projectId, boardId, columns } = await seedBoard(client, workspaceId)
    const other = await seedBoard(client, workspaceId)
    const token = await createToken(client, workspaceId, ['tasks:write', 'docs:write', 'organize'], 'Ordenador')
    const mcp = await connect(token.token)
    const call = async (name: string, args: Record<string, unknown>) => {
      const res = await mcp.callTool({ name, arguments: args })
      expect(res.isError, `${name}: ${text(res)}`).toBeFalsy()
      return res
    }
    const label = await client.post(`/api/boards/${boardId}/labels`, { name: 'Urgente', color: 'tomato' })
    const card = data(await call('create_card', { column_id: columns[0]!.id, title: 'Mudanza', label_ids: [label.body.id] }))
    const doc = data(await call('create_page', { project_id: projectId, title: 'Guía' }))
    const sub = data(await call('create_page', { project_id: projectId, title: 'Anexo' }))

    // Pages: an icon and a place in the tree.
    await call('update_page', { page_id: doc.page_id, icon: '📘' })
    await call('move_page', { page_id: sub.page_id, parent_id: doc.page_id, index: 0 })
    const guide = await client.get(`/api/pages/${doc.page_id}`)
    expect(guide.body).toMatchObject({ icon: '📘', children: [{ id: sub.page_id }] })

    // Files: up as text or base64, read back, moved to a page.
    const note = data(await call('upload_attachment', { card_id: card.card_id, filename: 'notas.md', mime_type: 'text/markdown', content: '# Lista\n- Cajas' }))
    expect(note.attachment).toMatchObject({ name: 'notas.md', size: 15 })
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5bd4b1f0000000049454e44ae426082', 'hex')
    const image = data(await call('upload_attachment', { card_id: card.card_id, filename: 'plano.png', content: png.toString('base64'), encoding: 'base64' }))
    expect(image.attachment.type).toBe('image/png')
    const listed = data(await call('get_card', { card_id: card.card_id }))
    expect(listed.attachments.map((a: { name: string }) => a.name).sort()).toEqual(['notas.md', 'plano.png'])
    const read = (await call('read_attachment', { attachment_id: note.attachment.id })) as { content: Array<{ type: string; text?: string }> }
    expect(read.content[1]).toEqual({ type: 'text', text: '# Lista\n- Cajas' })
    const seen = (await call('read_attachment', { attachment_id: image.attachment.id })) as { content: Array<{ type: string; data?: string; mimeType?: string }> }
    expect(seen.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png', data: png.toString('base64') })
    const tooBig = await mcp.callTool({ name: 'upload_attachment', arguments: { page_id: doc.page_id, filename: 'grande.txt', content: 'x'.repeat(5 * 1024 * 1024 + 1) } })
    expect(tooBig.isError).toBe(true)
    expect(text(tooBig)).toContain('5 MB')
    await call('move_attachment', { attachment_id: note.attachment.id, page_id: doc.page_id })
    expect(text(await call('read_page', { page_id: doc.page_id }))).toContain(`notas.md (${note.attachment.id}`)

    // To another board: the labels of the old one come off.
    await call('move_card', { card_id: card.card_id, column_id: other.columns[1]!.id })
    expect((await client.get(`/api/cards/${card.card_id}`)).body).toMatchObject({ board: { id: other.boardId }, labels: [] })

    // Deleting goes to the trash.
    const gone = data(await call('delete_attachment', { attachment_id: image.attachment.id }))
    expect(gone).toEqual({ deleted: true, trash_id: expect.any(String) })
    data(await call('delete_page', { page_id: sub.page_id }))
    const trash = (await client.get(`/api/workspaces/${workspaceId}/trash`)).body as Array<{ kind: string; title: string }>
    expect(trash.map((t) => `${t.kind}:${t.title}`).sort()).toEqual(['attachment:plano.png', 'page:Anexo'])

    // The history says what moved where; the person undoes everything the agent did since the move.
    const history = (await client.get(`/api/cards/${card.card_id}/history`)).body as Array<{ id: string; kind: string; meta: Record<string, unknown> }>
    const move = history.find((e) => e.kind === 'card.moved')!
    expect(move.meta).toMatchObject({ labels: ['Urgente'], labelIds: [label.body.id] })
    expect(String(move.meta.to)).toContain('›')
    const pageHistory = (await client.get(`/api/pages/${doc.page_id}/history`)).body as Array<{ kind: string; meta: Record<string, unknown> }>
    expect(pageHistory.find((e) => e.kind === 'attachment.moved')!.meta).toMatchObject({ name: 'notas.md', from: 'Mudanza', to: 'Guía' })
    // From its first upload on (the history lists the newest first).
    const undone = await client.post('/api/history/undo', { since: history.findLast((e) => e.kind === 'attachment.created')!.id })
    expect(undone.status).toBe(200)
    expect(undone.body).toMatchObject({ applied: true, failed: 0, skipped: 0 })
    const back = await client.get(`/api/cards/${card.card_id}`)
    expect(back.body).toMatchObject({ board: { id: boardId }, column: { id: columns[0]!.id } })
    expect(back.body.labels.map((l: { id: string }) => l.id)).toEqual([label.body.id])
    expect(back.body.attachmentList).toEqual([])
    // The files it uploaded go to the trash; the page it deleted comes back.
    expect((await client.get(`/api/pages/${doc.page_id}`)).body).toMatchObject({ attachments: [], children: [{ id: sub.page_id }] })
    const left = (await client.get(`/api/workspaces/${workspaceId}/trash`)).body as Array<{ kind: string; title: string }>
    expect(left.map((t) => `${t.kind}:${t.title}`).sort()).toEqual(['attachment:notas.md', 'attachment:plano.png'])
  })

  it('refuses to append past what a page holds, and leaves the page as it was', async () => {
    const { client, workspaceId } = await signUp(h)
    const { projectId } = await seedBoard(client, workspaceId)
    const mcp = await connect((await createToken(client, workspaceId, ['docs:write'])).token)
    const page = data(await mcp.callTool({ name: 'create_page', arguments: { project_id: projectId, title: 'Registro', content: 'a'.repeat(150_000) } }))

    // Each part fits on its own; together they would be a page nobody could save from the editor.
    const tooMuch = await mcp.callTool({ name: 'update_page', arguments: { page_id: page.page_id, content: 'b'.repeat(60_000), mode: 'append' } })
    expect(tooMuch.isError).toBe(true)
    expect(text(tooMuch)).toContain('210002 characters long, over the limit of 200000')
    expect(text(tooMuch)).toContain('at most 49998 more fit')
    const kept = await client.get(`/api/pages/${page.page_id}`)
    expect(kept.body).toMatchObject({ version: 1 })
    expect(kept.body.content).toHaveLength(150_000)

    // Up to the limit, exactly, still goes in.
    const fits = data(await mcp.callTool({ name: 'update_page', arguments: { page_id: page.page_id, content: 'b'.repeat(49_998), mode: 'append' } }))
    expect(fits.version).toBe(2)
    expect((await client.get(`/api/pages/${page.page_id}`)).body.content).toHaveLength(200_000)
    const full = await mcp.callTool({ name: 'update_page', arguments: { page_id: page.page_id, content: 'c', mode: 'append' } })
    expect(full.isError).toBe(true)
    expect(text(full)).toContain('at most 0 more fit')
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
