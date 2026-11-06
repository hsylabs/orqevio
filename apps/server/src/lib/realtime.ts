import type { RealtimeEvent } from '@orqevio/shared'
import pg from 'pg'

type Listener = (event: RealtimeEvent) => void
const CHANNEL = 'orqevio_events'

/**
 * Workspace-scoped event bus. Events are published through Postgres
 * NOTIFY and received through LISTEN, so every server replica fans them
 * out to its own SSE clients without extra infrastructure.
 */
export class RealtimeBus {
  private readonly listeners = new Map<string, Set<Listener>>()
  private client: pg.Client | null = null
  private stopped = false
  private retryMs = 500

  constructor(
    private readonly connectionString: string,
    private readonly pool: pg.Pool,
  ) {}

  async start() {
    this.stopped = false
    await this.connect()
  }

  async stop() {
    this.stopped = true
    const client = this.client
    this.client = null
    await client?.end().catch(() => {})
  }

  subscribe(workspaceId: string, listener: Listener) {
    let set = this.listeners.get(workspaceId)
    if (!set) this.listeners.set(workspaceId, (set = new Set()))
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(workspaceId)
    }
  }

  async publish(workspaceId: string, event: RealtimeEvent) {
    const safe = { ...event, summary: event.summary?.slice(0, 200) }
    await this.pool.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify({ w: workspaceId, e: safe })])
  }

  private async connect() {
    const client = new pg.Client({ connectionString: this.connectionString })
    client.on('notification', (msg) => {
      if (!msg.payload) return
      try {
        const { w, e } = JSON.parse(msg.payload) as { w: string; e: RealtimeEvent }
        for (const listener of this.listeners.get(w) ?? []) listener(e)
      } catch (error) {
        console.error('[realtime] invalid payload', error)
      }
    })
    client.on('error', (error) => {
      console.error('[realtime] connection error', error.message)
      this.reconnect(client)
    })
    client.on('end', () => this.reconnect(client))
    await client.connect()
    await client.query(`LISTEN ${CHANNEL}`)
    this.client = client
    this.retryMs = 500
  }

  private reconnect(failed: pg.Client) {
    if (this.stopped || this.client !== failed) return
    this.client = null
    const wait = this.retryMs
    this.retryMs = Math.min(this.retryMs * 2, 15_000)
    setTimeout(() => {
      if (!this.stopped) this.connect().catch(() => this.reconnectLater())
    }, wait)
  }

  private reconnectLater() {
    const placeholder = new pg.Client()
    this.client = placeholder
    this.reconnect(placeholder)
  }
}
