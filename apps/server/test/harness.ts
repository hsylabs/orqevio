import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { createApp } from '../src/app'
import { createDatabase, runMigrations } from '../src/db/client'
import { loadEnv } from '../src/env'
import { RealtimeBus } from '../src/lib/realtime'
import { LocalStorage } from '../src/lib/storage'
import { createServices } from '../src/services'

export const ORIGIN = 'http://localhost:3000'

export async function createHarness() {
  process.env.APP_URL = ORIGIN
  const databaseUrl = process.env.TEST_DATABASE_URL ?? 'postgres://orqevio:orqevio@localhost:5432/orqevio_test'
  const dataDir = await mkdtemp(path.join(tmpdir(), 'orqevio-test-'))
  const env = loadEnv({ databaseUrl, dataDir, webDist: path.join(dataDir, 'no-web') })
  const { db, pool } = createDatabase(databaseUrl)
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`)
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
  await db.execute(sql`CREATE SCHEMA public`)
  await runMigrations(db, env.migrationsDir)
  const bus = new RealtimeBus(databaseUrl, pool)
  await bus.start()
  const services = createServices({ db, bus, env, storage: new LocalStorage(path.join(dataDir, 'uploads')) })
  const app = createApp(env, services)
  return {
    app,
    db,
    services,
    bus,
    async close() {
      await bus.stop()
      await pool.end()
    },
  }
}

export type Harness = Awaited<ReturnType<typeof createHarness>>

/** Minimal HTTP client that keeps the session cookie like a browser would. */
export class Client {
  cookie = ''
  constructor(
    private readonly harness: Harness,
    private readonly bearer?: string,
  ) {}

  async request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const init: RequestInit = { method, headers: { Origin: ORIGIN, ...headers } }
    const h = init.headers as Record<string, string>
    if (this.cookie) h.Cookie = this.cookie
    if (this.bearer) h.Authorization = `Bearer ${this.bearer}`
    if (body instanceof FormData) init.body = body
    else if (body !== undefined) {
      h['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    const res = await this.harness.app.request(url, init)
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) {
      const pair = setCookie.split(';')[0]!
      this.cookie = pair.endsWith('=') ? '' : pair
    }
    const text = await res.text()
    let json: any = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = text
    }
    return { status: res.status, body: json, headers: res.headers }
  }

  get = (url: string) => this.request('GET', url)
  post = (url: string, body?: unknown) => this.request('POST', url, body ?? {})
  patch = (url: string, body: unknown) => this.request('PATCH', url, body)
  put = (url: string, body: unknown) => this.request('PUT', url, body)
  del = (url: string) => this.request('DELETE', url)
}

let counter = 0
export async function signUp(harness: Harness, name = 'Ana López') {
  const client = new Client(harness)
  const email = `user${Date.now()}${counter++}@example.com`
  const res = await client.post('/api/auth/register', { name, email, password: 'correct-horse-battery' })
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`)
  const me = await client.get('/api/auth/me')
  return { client, email, user: me.body.user, workspaceId: me.body.workspaces[0].id as string }
}

export async function seedBoard(client: Client, workspaceId: string) {
  const project = await client.post(`/api/workspaces/${workspaceId}/projects`, { name: 'Lanzamiento', color: 'tomato' })
  const board = await client.post(`/api/projects/${project.body.id}/boards`, { name: 'Producto' })
  const detail = await client.get(`/api/boards/${board.body.id}`)
  return { projectId: project.body.id as string, boardId: board.body.id as string, columns: detail.body.columns as Array<{ id: string; name: string }> }
}
