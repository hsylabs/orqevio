import { LIVE_CLOSE, type LiveMessage } from '@orqevio/shared'
import { DurableObject } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/durable-sqlite'
import { migrate } from 'drizzle-orm/durable-sqlite/migrator'
import { createApp } from '../app'
import type { Database } from '../db/client'
import * as schema from '../db/schema'
import type { Env } from '../env'
import { LIVE_PATH, authorizeLive, isAllowedOrigin, readCookie } from '../http/live-session'
import { sessionCookieName } from '../http/middleware'
import { type Services, createServices } from '../services'
import { type Bindings, workerEnv } from './env'
import migrations from './migrations.gen'
import { R2Storage } from './r2-storage'

const SWEEP_EVERY_MS = 60 * 60 * 1000
/** Requests after which every live connection is checked again (sign-out, new key, recovery, deletion). */
const CHANGES_ACCESS = /^\/api\/(?:auth|account)\//

interface LiveAttachment {
  token: string
  workspaceId: string
}

/**
 * The whole copy of Orqevio lives in this single Durable Object: its SQLite
 * database, the app that serves /api and /mcp, and the live WebSocket
 * connections.
 *
 * Live connections use the hibernation API: the browser's "ping" heartbeat is
 * answered by the runtime without waking the object, so an idle copy costs
 * nothing while tabs stay open. Access is checked when the connection opens,
 * before each change is delivered, and right after any request that can end a
 * session, so a signed-out or removed member stops receiving events.
 */
export class OrqevioCopy extends DurableObject<Bindings> {
  private readonly config: Env
  private readonly services: Services
  private readonly app: ReturnType<typeof createApp>

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env)
    this.config = workerEnv(env)
    const db = drizzle(ctx.storage, { schema })
    this.services = createServices({
      db: db as unknown as Database,
      bus: { publish: (workspaceId, event) => ctx.waitUntil(this.deliver(ctx.getWebSockets(workspaceId), { type: 'change', event })) },
      env: this.config,
      storage: new R2Storage(env.UPLOADS),
    })
    this.app = createApp(this.config, this.services, { clientIp: (c) => c.req.header('cf-connecting-ip') ?? 'unknown' })
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
    void ctx.blockConcurrencyWhile(async () => {
      await migrate(db, migrations)
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + SWEEP_EVERY_MS)
      const notice = await this.services.accounts.setupNotice()
      if (notice && !this.config.setupCode) {
        console.warn('This copy has no SETUP_CODE secret. Set one with `wrangler secret put SETUP_CODE` to claim it.')
      }
    })
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    // Cookies are Secure (and __Host- prefixed) on https; local development runs on http.
    this.config.secureCookies = url.protocol === 'https:'
    const live = LIVE_PATH.exec(url.pathname)
    if (live && request.headers.get('upgrade')?.toLowerCase() === 'websocket') return this.openLive(request, live[1]!.toLowerCase())
    const response = await this.app.fetch(request)
    if (request.method !== 'GET' && CHANGES_ACCESS.test(url.pathname)) await this.deliver(this.ctx.getWebSockets(), null)
    return response
  }

  private async openLive(request: Request, workspaceId: string) {
    if (!isAllowedOrigin(this.config, request.url, request.headers.get('origin'))) return new Response(null, { status: 403 })
    const token = readCookie(request.headers.get('cookie'), sessionCookieName(this.config))
    const result = await authorizeLive(this.services, token, workspaceId)
    if (result === 401 || result === 404) return new Response(null, { status: result })
    const { 0: client, 1: server } = new WebSocketPair()
    this.ctx.acceptWebSocket(server, [workspaceId])
    server.serializeAttachment({ token: token!, workspaceId } satisfies LiveAttachment)
    server.send(JSON.stringify({ type: 'ready' } satisfies LiveMessage))
    return new Response(null, { status: 101, webSocket: client })
  }

  /** "ping" is answered by the auto-response; nothing else is expected from the browser. */
  override async webSocketMessage() {}


  /**
   * Checks each connection's session and membership, closes the ones that lost
   * access, and sends `message` (if any) to the rest.
   */
  private async deliver(sockets: WebSocket[], message: LiveMessage | null) {
    const text = message && JSON.stringify(message)
    const verdicts = new Map<string, ReturnType<typeof authorizeLive>>()
    await Promise.all(
      sockets.map(async (ws) => {
        const { token, workspaceId } = ws.deserializeAttachment() as LiveAttachment
        const key = `${token} ${workspaceId}`
        let verdict = verdicts.get(key)
        if (!verdict) verdicts.set(key, (verdict = authorizeLive(this.services, token, workspaceId)))
        try {
          const result = await verdict
          if (result === 401) ws.close(LIVE_CLOSE.sessionEnded, 'session_ended')
          else if (result === 404) ws.close(LIVE_CLOSE.noAccess, 'no_access')
          else if (text) ws.send(text)
        } catch {
          // The socket is closing, or the check failed: the browser reconnects and refetches.
        }
      }),
    )
  }

  /** Hourly: removes attachments left in R2 without a database row. */
  override async alarm() {
    try {
      await this.services.attachments.sweepOrphans()
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_EVERY_MS)
    }
  }
}
