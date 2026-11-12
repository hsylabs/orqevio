import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadEnv } from '../src/env'
import { Access } from '../src/services/access'
import type { Deps } from '../src/services/deps'
import { UpdateService, isNewer } from '../src/services/updates'
import { VERSION } from '../src/version'
import { Client, type Harness, createHarness, signInOwner } from './harness'

const owner = { kind: 'user', userId: 'u', name: 'Ana', sessionId: 's' } as const

function service(answers: Array<Response | Error>, env: Partial<ReturnType<typeof loadEnv>> = {}) {
  const calls: string[] = []
  const fetch = (async (url: string) => {
    calls.push(String(url))
    const next = answers.shift() ?? new Error('no more answers')
    if (next instanceof Error) throw next
    return next
  }) as unknown as typeof globalThis.fetch
  const deps = { env: loadEnv({ install: 'cli', copyName: 'ana', updateCheck: true, ...env }), fetch } as unknown as Deps
  return { updates: new UpdateService(deps, new Access(deps)), calls }
}
const published = (version: string) => new Response(JSON.stringify({ name: 'orqevio', version }), { headers: { 'Content-Type': 'application/json' } })

describe('update notice', () => {
  it('compares versions numerically, with pre-releases before their release', () => {
    expect(isNewer('0.10.0', '0.9.0')).toBe(true)
    expect(isNewer('1.0.0', '0.99.99')).toBe(true)
    expect(isNewer('0.2.0', '0.2.0')).toBe(false)
    expect(isNewer('0.1.9', '0.2.0')).toBe(false)
    expect(isNewer('0.2.0', '0.2.0-rc.2')).toBe(true)
    expect(isNewer('0.2.0-rc.10', '0.2.0-rc.2')).toBe(true)
    expect(isNewer('0.2.0-rc.1', '0.2.0')).toBe(false)
    expect(isNewer('nonsense', '0.1.0')).toBe(false)
  })

  it('reports a newer version with how this copy updates, and asks the registry only once', async () => {
    const { updates, calls } = service([published('99.0.0')])
    const status = await updates.status(owner)
    expect(status).toEqual({
      current: VERSION,
      latest: '99.0.0',
      updateAvailable: true,
      install: 'cli',
      copyName: 'ana',
      releaseUrl: 'https://github.com/hsylabs/orqevio/releases/tag/v99.0.0',
    })
    expect(calls).toEqual(['https://registry.npmjs.org/orqevio/latest'])
    await Promise.all([updates.status(owner), updates.status(owner)])
    expect(calls).toHaveLength(1)
  })

  it('stays quiet when up to date, offline or not published yet', async () => {
    expect(await service([published(VERSION)]).updates.status(owner)).toMatchObject({ latest: VERSION, updateAvailable: false, releaseUrl: null })
    const offline = service([new Error('offline'), published('99.0.0')])
    expect(await offline.updates.status(owner)).toMatchObject({ latest: null, updateAvailable: false })
    // A failure is remembered for a while instead of retried on every request.
    expect(await offline.updates.status(owner)).toMatchObject({ latest: null })
    expect(offline.calls).toHaveLength(1)
    expect(await service([new Response('Not Found', { status: 404 })]).updates.status(owner)).toMatchObject({ latest: null, updateAvailable: false })
    expect(await service([published('not-a-version')]).updates.status(owner)).toMatchObject({ latest: null })
  })

  it('never contacts the registry with UPDATE_CHECK=off', async () => {
    const { updates, calls } = service([published('99.0.0')], { updateCheck: false })
    expect(await updates.status(owner)).toMatchObject({ latest: null, updateAvailable: false })
    expect(calls).toEqual([])
  })
})

describe('GET /api/updates', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createHarness()
  })
  afterAll(async () => h.close())

  it('is only for the owner in the app', async () => {
    expect((await new Client(h).get('/api/updates')).status).toBe(401)
    const { client, workspaceId } = await signInOwner(h)
    const status = await client.get('/api/updates')
    expect(status.status).toBe(200)
    expect(status.body).toEqual({ current: VERSION, latest: null, updateAvailable: false, install: 'source', copyName: null, releaseUrl: null })
    const token = (await client.post('/api/tokens', { name: 'Agente', workspaceId, scopes: ['tasks:read'], expiresInDays: 30 })).body.token as string
    const agent = await new Client(h, token).get('/api/updates')
    expect(agent.status).toBe(403)
    expect(agent.body.error.code).toBe('session_required')
  })
})
