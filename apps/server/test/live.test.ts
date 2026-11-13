import { type AddressInfo, connect as tcpConnect } from 'node:net'
import { serve } from '@hono/node-server'
import { LIVE_CLOSE, type LiveMessage } from '@orqevio/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { sha256 } from '../src/auth/crypto'
import { sessions } from '../src/db/schema'
import { attachLiveUpdates } from '../src/node/live'
import { type Harness, ORIGIN, createHarness, seedBoard, signInOwner, signUp } from './harness'

let h: Harness
let server: ReturnType<typeof serve>
let base: string

beforeAll(async () => {
  h = await createHarness()
  server = serve({ fetch: h.app.fetch, port: 0, hostname: '127.0.0.1' })
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  attachLiveUpdates(server as never, h.env, h.services, h.bus)
  base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await h.close()
})

/** Opens a live connection and resolves with the HTTP status it was refused with, or the open socket. */
function connect(workspaceId: string, headers: Record<string, string>) {
  return new Promise<{ ws: WebSocket; messages: Array<LiveMessage | 'pong'>; closed: Promise<number> } | { status: number }>((resolve) => {
    const ws = new WebSocket(`${base}/api/workspaces/${workspaceId}/live`, { headers })
    const messages: Array<LiveMessage | 'pong'> = []
    const closed = new Promise<number>((done) => ws.on('close', (code) => done(code)))
    ws.on('message', (data) => {
      const text = data.toString()
      messages.push(text === 'pong' ? 'pong' : (JSON.parse(text) as LiveMessage))
    })
    ws.on('open', () => resolve({ ws, messages, closed }))
    ws.on('unexpected-response', (_req, res) => resolve({ status: res.statusCode ?? 0 }))
  })
}

async function until(check: () => boolean, ms = 2000) {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('live updates over WebSocket', () => {
  it('refuses connections without a session, from other origins or to other workspaces', async () => {
    const { client, workspaceId } = await signUp(h)
    const stranger = await signUp(h, 'Ajena')
    expect(await connect(workspaceId, { Origin: ORIGIN })).toEqual({ status: 401 })
    expect(await connect(workspaceId, { Origin: 'https://evil.example', Cookie: client.cookie })).toEqual({ status: 403 })
    expect(await connect(workspaceId, { Cookie: client.cookie })).toEqual({ status: 403 })
    expect(await connect(stranger.workspaceId, { Origin: ORIGIN, Cookie: client.cookie })).toEqual({ status: 404 })
    expect(await connect('00000000-0000-4000-8000-000000000000', { Origin: ORIGIN, Cookie: client.cookie })).toEqual({ status: 404 })
  })

  it('delivers workspace changes and answers pings', async () => {
    const { client, workspaceId } = await signInOwner(h)
    const live = await connect(workspaceId, { Origin: ORIGIN, Cookie: client.cookie })
    if ('status' in live) throw new Error(`refused: ${live.status}`)
    await until(() => live.messages.length > 0)
    expect(live.messages[0]).toEqual({ type: 'ready' })

    const { columns } = await seedBoard(client, workspaceId)
    await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'En directo' })
    await until(() => live.messages.some((m) => m !== 'pong' && m.type === 'change' && m.event.action === 'card.created'))
    const created = live.messages.find((m) => m !== 'pong' && m.type === 'change' && m.event.action === 'card.created')
    expect(created).toMatchObject({ type: 'change', event: { summary: 'En directo', actor: { kind: 'user' } } })

    live.ws.send('ping')
    await until(() => live.messages.includes('pong'))
    live.ws.close()
    await live.closed
  })

  it('survives malformed upgrade requests', async () => {
    const { port } = server.address() as AddressInfo
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = tcpConnect(port, '127.0.0.1', () => {
        socket.write('GET // HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
      })
      let data = ''
      socket.on('data', (chunk) => (data += chunk.toString()))
      socket.on('end', () => resolve(data))
      socket.on('error', reject)
    })
    expect(reply).toMatch(/^HTTP\/1\.1 404/)
    expect((await h.app.request('/healthz')).status).toBe(200)
    const { client, workspaceId } = await signInOwner(h)
    const live = await connect(workspaceId, { Origin: ORIGIN, Cookie: client.cookie })
    if ('status' in live) throw new Error(`refused: ${live.status}`)
    live.ws.close()
    await live.closed
  })

  it('pings do not extend the session, so the next HTTP request still renews the cookie', async () => {
    const { client, workspaceId } = await signInOwner(h)
    const token = decodeURIComponent(client.cookie.split('=').slice(1).join('='))
    const stale = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    await h.db.update(sessions).set({ lastSeenAt: stale }).where(eq(sessions.id, sha256(token)))
    const live = await connect(workspaceId, { Origin: ORIGIN, Cookie: client.cookie })
    if ('status' in live) throw new Error(`refused: ${live.status}`)
    live.ws.send('ping')
    await until(() => live.messages.includes('pong'))
    const [row] = await h.db.select().from(sessions).where(eq(sessions.id, sha256(token)))
    expect(row!.lastSeenAt.getTime()).toBe(stale.getTime())
    const res = await client.get('/api/auth/me')
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeTruthy()
    live.ws.close()
    await live.closed
  })

  it('closes the connection on the next ping once the session ends', async () => {
    const { client, workspaceId } = await signInOwner(h)
    const live = await connect(workspaceId, { Origin: ORIGIN, Cookie: client.cookie })
    if ('status' in live) throw new Error(`refused: ${live.status}`)
    await until(() => live.messages.length > 0)
    expect((await client.post('/api/auth/logout')).status).toBe(204)
    live.ws.send('ping')
    expect(await live.closed).toBe(LIVE_CLOSE.sessionEnded)
  })
})
