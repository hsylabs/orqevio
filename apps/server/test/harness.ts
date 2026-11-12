import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp } from '../src/app'
import { sha256 } from '../src/auth/crypto'
import { openDatabase, runMigrations } from '../src/db/client'
import { sessions, users, workspaceMembers, workspaces } from '../src/db/schema'
import { loadEnv } from '../src/env'
import { RealtimeBus } from '../src/lib/realtime'
import { LocalStorage } from '../src/lib/storage-local'
import { createServices } from '../src/services'

export const ORIGIN = 'http://localhost:3000'
export const SETUP_CODE = 'test-setup-code-1234'

/** Each test file gets a fresh copy: its own SQLite file and upload folder. */
export async function createHarness() {
  process.env.APP_URL = ORIGIN
  const dataDir = await mkdtemp(path.join(tmpdir(), 'orqevio-test-'))
  const env = loadEnv({ dataDir, databasePath: path.join(dataDir, 'orqevio.db'), webDist: path.join(dataDir, 'no-web'), setupCode: SETUP_CODE })
  const { db, close } = openDatabase(env.databasePath)
  runMigrations(db, env.migrationsDir)
  const bus = new RealtimeBus()
  const services = createServices({ db, bus, env, storage: new LocalStorage(path.join(dataDir, 'uploads')) })
  const app = createApp(env, services)
  return {
    app,
    db,
    env,
    services,
    bus,
    /** Filled by the first signUp() of a test file, which claims the copy. */
    owner: null as null | { accessKey: string; userId: string; workspaceId: string },
    async close() {
      close()
      await rm(dataDir, { recursive: true, force: true })
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
    if (body instanceof FormData || body instanceof Uint8Array || body instanceof Blob) init.body = body as RequestInit['body']
    else if (body instanceof ReadableStream) Object.assign(init, { body, duplex: 'half' })
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

  /** Uploads like the web app does: the raw file as the body, its name in X-File-Name. */
  upload = (url: string, data: Uint8Array | string, { name = 'file.bin', type = 'application/octet-stream', length }: { name?: string; type?: string; length?: number } = {}) => {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    return this.request('POST', url, bytes, { 'Content-Type': type, 'Content-Length': String(length ?? bytes.byteLength), 'X-File-Name': encodeURIComponent(name) })
  }

  get = (url: string) => this.request('GET', url)
  post = (url: string, body?: unknown) => this.request('POST', url, body ?? {})
  patch = (url: string, body: unknown) => this.request('PATCH', url, body)
  put = (url: string, body: unknown) => this.request('PUT', url, body)
  del = (url: string) => this.request('DELETE', url)
}

/**
 * The first call claims the copy and returns its owner. Later calls add extra
 * members directly in the database, each with its own workspace and session, so
 * tests stay isolated and permission checks between people keep their coverage.
 */
export async function signUp(harness: Harness, name = 'Ana López') {
  const client = new Client(harness)
  if (!harness.owner) {
    const res = await client.post('/api/auth/claim', { setupCode: SETUP_CODE, name })
    if (res.status !== 201) throw new Error(`claim failed: ${JSON.stringify(res.body)}`)
    const me = await client.get('/api/auth/me')
    harness.owner = { accessKey: res.body.accessKey, userId: me.body.user.id, workspaceId: me.body.workspaces[0].id }
    return { client, user: me.body.user, workspaceId: harness.owner.workspaceId, accessKey: res.body.accessKey as string }
  }
  const [user] = await harness.db.insert(users).values({ name }).returning()
  const [workspace] = await harness.db.insert(workspaces).values({ name: `Espacio de ${name.split(/\s+/)[0]}` }).returning()
  await harness.db.insert(workspaceMembers).values({ workspaceId: workspace!.id, userId: user!.id, role: 'owner' })
  const token = randomBytes(32).toString('base64url')
  await harness.db.insert(sessions).values({ id: sha256(token), userId: user!.id, expiresAt: new Date(Date.now() + 86_400_000) })
  client.cookie = `orq_session=${token}`
  const me = await client.get('/api/auth/me')
  return { client, user: me.body.user, workspaceId: workspace!.id, accessKey: null }
}

/** A new browser-like client signed in as the owner with the access key. */
export async function signInOwner(harness: Harness) {
  if (!harness.owner) await signUp(harness)
  const client = new Client(harness)
  const res = await client.post('/api/auth/login', { accessKey: harness.owner!.accessKey })
  if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`)
  return { client, workspaceId: harness.owner!.workspaceId, accessKey: harness.owner!.accessKey }
}

export async function seedBoard(client: Client, workspaceId: string) {
  const project = await client.post(`/api/workspaces/${workspaceId}/projects`, { name: 'Lanzamiento', color: 'tomato' })
  const board = await client.post(`/api/projects/${project.body.id}/boards`, { name: 'Producto' })
  const detail = await client.get(`/api/boards/${board.body.id}`)
  return { projectId: project.body.id as string, boardId: board.body.id as string, columns: detail.body.columns as Array<{ id: string; name: string }> }
}
