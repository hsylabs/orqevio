import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { nodePlatform } from '../src/node/platform'
import { type Harness, ORIGIN, createHarness, seedBoard, signUp } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => h.close())

async function agent(scopes: string[]) {
  const { client, workspaceId } = await signUp(h)
  const token = (await client.post('/api/tokens', { name: 'Claude', workspaceId, scopes, expiresInDays: 30 })).body.token as string
  const rpc = async (body: unknown) => {
    const res = await h.app.request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    })
    return (await res.json()) as { error?: { code: number; message: string }; result?: unknown }
  }
  const mcp = new McpClient({ name: 'test', version: '1.0.0' })
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } }, fetch: async (url, init) => h.app.request(String(url), init) }))
  return { client, workspaceId, rpc, mcp }
}

describe('small fixes for agents', () => {
  it('add_checklist_items adds all the items or, if one is not valid, none', async () => {
    const { client, workspaceId, mcp } = await agent(['tasks:read', 'tasks:write'])
    const { columns } = await seedBoard(client, workspaceId)
    const card = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Preparar el viaje' })

    const failed = await mcp.callTool({ name: 'add_checklist_items', arguments: { card_id: card.body.id, checklist_title: 'Maleta', items: ['Pasaporte', '   ', 'Cargador'] } })
    expect(failed.isError).toBe(true)
    expect((await client.get(`/api/cards/${card.body.id}`)).body.checklists).toEqual([])

    const done = await mcp.callTool({ name: 'add_checklist_items', arguments: { card_id: card.body.id, checklist_title: 'Maleta', items: ['Pasaporte', 'Cargador'] } })
    expect(done.isError).toBeFalsy()
    const [list] = (await client.get(`/api/cards/${card.body.id}`)).body.checklists
    expect(list.title).toBe('Maleta')
    expect(list.items.map((i: { text: string }) => i.text)).toEqual(['Pasaporte', 'Cargador'])

    // To the same checklist, after the others.
    await mcp.callTool({ name: 'add_checklist_items', arguments: { card_id: card.body.id, checklist_id: list.id, items: ['Gafas'] } })
    const [again] = (await client.get(`/api/cards/${card.body.id}`)).body.checklists
    expect(again.items.map((i: { text: string }) => i.text)).toEqual(['Pasaporte', 'Cargador', 'Gafas'])
    await mcp.close()
  })

  it('create_checklist makes an empty checklist, which add_checklist_items then fills', async () => {
    const { client, workspaceId, mcp } = await agent(['tasks:read', 'tasks:write'])
    const { columns } = await seedBoard(client, workspaceId)
    const card = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Copiada de Trello' })
    const checklists = async () => (await client.get(`/api/cards/${card.body.id}`)).body.checklists as Array<{ id: string; title: string; items: Array<{ text: string }> }>

    // As on Trello: two checklists with the same name and nothing in them yet.
    const first = await mcp.callTool({ name: 'create_checklist', arguments: { card_id: card.body.id, title: 'Pendientes' } })
    expect(first.isError).toBeFalsy()
    const created = JSON.parse((first.content as Array<{ text: string }>)[0]!.text)
    expect(created).toMatchObject({ created: true, title: 'Pendientes' })
    await mcp.callTool({ name: 'create_checklist', arguments: { card_id: card.body.id, title: 'Pendientes' } })
    expect((await checklists()).map((c) => [c.id === created.checklist_id, c.title, c.items.length])).toEqual([
      [true, 'Pendientes', 0],
      [false, 'Pendientes', 0],
    ])

    await mcp.callTool({ name: 'add_checklist_items', arguments: { card_id: card.body.id, checklist_id: created.checklist_id, items: ['Revisar', 'Publicar'] } })
    const [filled, empty] = await checklists()
    expect(filled!.items.map((i) => i.text)).toEqual(['Revisar', 'Publicar'])
    expect(empty!.items).toEqual([])

    // A blank title is refused, and leaves the card as it was.
    const blank = await mcp.callTool({ name: 'create_checklist', arguments: { card_id: card.body.id, title: '   ' } })
    expect(blank.isError).toBe(true)
    expect(await checklists()).toHaveLength(2)

    // The card's history says who made each one.
    const history = (await client.get(`/api/cards/${card.body.id}/history`)).body as Array<{ kind: string; actor: { kind: string } }>
    expect(history.filter((e) => e.kind === 'checklist.created').map((e) => e.actor.kind)).toEqual(['agent', 'agent'])
    await mcp.close()

    // Only an agent allowed to write tasks has it.
    const reader = await agent(['tasks:read'])
    expect((await reader.mcp.listTools()).tools.map((t) => t.name)).not.toContain('create_checklist')
    await reader.mcp.close()
  })

  it('a malformed MCP request is invalid params (-32602), not an internal error', async () => {
    const { rpc, mcp } = await agent(['tasks:read'])
    for (const params of [undefined, {}, { name: 5 }, { name: 'list_projects', arguments: 'x' }]) {
      const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', ...(params === undefined ? {} : { params }) })
      expect(res.error?.code, JSON.stringify(params)).toBe(-32602)
    }
    // Well-formed calls still work.
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_projects', arguments: {} } })).result).toBeDefined()
    await mcp.close()
  })

  it('a token asked for with only "organize" is refused: it would read and write nothing', async () => {
    const { client, workspaceId } = await signUp(h)
    const res = await client.post('/api/tokens', { name: 'Solo organizar', workspaceId, scopes: ['organize'], expiresInDays: 30 })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toContain('organize')
    expect((await client.get('/api/tokens')).body).toEqual([])
    // With something to write, it is kept.
    const ok = await client.post('/api/tokens', { name: 'Organizar tareas', workspaceId, scopes: ['tasks:write', 'organize'], expiresInDays: 30 })
    expect(ok.status).toBe(201)
    expect(ok.body.scopes).toEqual(['tasks:read', 'tasks:write', 'organize'])
  })

  it('upload_attachment refuses content that is not base64 instead of storing a damaged file', async () => {
    const { client, workspaceId, mcp } = await agent(['docs:read', 'docs:write'])
    const { projectId } = await seedBoard(client, workspaceId)
    const page = await client.post(`/api/projects/${projectId}/pages`, { title: 'Adjuntos' })
    const upload = (content: string) => mcp.callTool({ name: 'upload_attachment', arguments: { page_id: page.body.id, filename: 'punto.png', mime_type: 'image/png', content, encoding: 'base64' } })
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const dataUrl = await upload(`data:image/png;base64,${png}`)
    expect(dataUrl.isError).toBe(true)
    expect(JSON.stringify(dataUrl.content)).toContain('data: URL')
    for (const bad of ['¡esto no es base64!', 'abcde', 'SGVsbG8===', 'SGV+bG8_']) {
      const res = await upload(bad)
      expect(res.isError, bad).toBe(true)
      expect(JSON.stringify(res.content), bad).toContain('not valid base64')
    }
    expect((await client.get(`/api/pages/${page.body.id}`)).body.attachments ?? []).toEqual([])
    // Base64 as it comes, with line breaks, or URL-safe, goes in whole.
    const wrapped = await upload(png.replace(/(.{20})/g, '$1\n'))
    expect(wrapped.isError).toBeFalsy()
    const urlSafe = await upload(Buffer.from([0xfb, 0xff, 0xfe]).toString('base64url'))
    expect(urlSafe.isError).toBeFalsy()
    const files = (await client.get(`/api/pages/${page.body.id}`)).body.attachments as Array<{ size: number }>
    expect(files.map((f) => f.size).sort((a, b) => a - b)).toEqual([3, Buffer.from(png, 'base64').length])
  })

  it('JSON that is not a JSON-RPC request is an invalid request (-32600), not a parse error', async () => {
    const { rpc, mcp } = await agent(['tasks:read'])
    for (const body of [{ hello: 1 }, [{ hello: 1 }], { jsonrpc: '1.0', id: 1, method: 'tools/list' }, 'texto']) {
      const res = await rpc(body)
      expect(res.error?.code, JSON.stringify(body)).toBe(-32600)
    }
    await mcp.close()
  })

  it('an OAuth registration with an address too long says so, not that the list is wrong', async () => {
    const res = await h.app.request('/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [`https://claude.ai/${'x'.repeat(520)}`], client_name: 'Claude' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; error_description: string }
    expect(body.error).toBe('invalid_client_metadata')
    expect(body.error_description).toContain('at most 500 characters')
    expect(body.error_description).not.toContain('one to five')
  })

  it('an OAuth registration says which field is wrong', async () => {
    const register = async (body: unknown) => {
      const res = await h.app.request('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      return { status: res.status, body: (await res.json()) as { error: string; error_description: string } }
    }
    const longName = await register({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], client_name: 'x'.repeat(201) })
    expect(longName.status).toBe(400)
    expect(longName.body).toMatchObject({ error: 'invalid_client_metadata', error_description: expect.stringContaining('client_name') })
    const noUris = await register({ client_name: 'Claude' })
    expect(noUris.body.error_description).toContain('redirect_uris')
  })

  it('unknown server addresses are a 404, while the app keeps its own addresses', async () => {
    const webDist = path.join(h.env.dataDir, 'web')
    await mkdir(webDist, { recursive: true })
    await writeFile(path.join(webDist, 'index.html'), '<!doctype html><title>Orqevio</title>')
    const env = { ...h.env, webDist }
    const app = createApp(env, h.services, nodePlatform(env))
    for (const address of ['/.well-known/openid-configuration', '/api/nope']) {
      const res = await app.request(address)
      expect(res.status, address).toBe(404)
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_found')
    }
    // The OAuth metadata is still there, and any other address is the web app.
    expect((await app.request('/.well-known/oauth-authorization-server')).status).toBe(200)
    const page = await app.request('/w/123/b/456')
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('<title>Orqevio</title>')
  })
})
