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
