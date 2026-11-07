import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, type Harness, createHarness, signUp } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => h.close())

describe('authentication', () => {
  it('registers, creates a default workspace and sets a hardened cookie', async () => {
    const client = new Client(h)
    const res = await client.post('/api/auth/register', { name: 'Marta Ruiz', email: 'Marta@Example.com', password: 'a-long-password' })
    expect(res.status).toBe(201)
    expect(res.body.user.email).toBe('marta@example.com')
    const cookie = res.headers.get('set-cookie')!
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    const me = await client.get('/api/auth/me')
    expect(me.body.workspaces).toHaveLength(1)
    expect(me.body.workspaces[0].name).toBe('Espacio de Marta')
  })

  it('rejects duplicate emails, short passwords and wrong credentials', async () => {
    const { email } = await signUp(h)
    const client = new Client(h)
    expect((await client.post('/api/auth/register', { name: 'X', email, password: 'another-password' })).status).toBe(409)
    expect((await client.post('/api/auth/register', { name: 'X', email: 'new@example.com', password: 'short' })).status).toBe(400)
    const wrong = await client.post('/api/auth/login', { email, password: 'not-the-password' })
    expect(wrong.status).toBe(401)
    expect(wrong.body.error.code).toBe('invalid_credentials')
    const unknown = await client.post('/api/auth/login', { email: 'nobody@example.com', password: 'whatever-123' })
    expect(unknown.status).toBe(401)
    const good = await client.post('/api/auth/login', { email, password: 'correct-horse-battery' })
    expect(good.status).toBe(200)
  })

  it('requires authentication and logs out', async () => {
    expect((await new Client(h).get('/api/auth/me')).status).toBe(401)
    const { client } = await signUp(h)
    expect((await client.post('/api/auth/logout')).status).toBe(204)
    expect((await client.get('/api/auth/me')).status).toBe(401)
  })

  it('blocks cross-origin state-changing requests', async () => {
    const { client, workspaceId } = await signUp(h)
    const res = await client.request('POST', `/api/workspaces/${workspaceId}/projects`, { name: 'X' }, { Origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('bad_origin')
  })

  it('changing the password signs out other sessions', async () => {
    const { client, email } = await signUp(h)
    const other = new Client(h)
    await other.post('/api/auth/login', { email, password: 'correct-horse-battery' })
    expect((await other.get('/api/auth/me')).status).toBe(200)
    const res = await client.post('/api/account/password', { currentPassword: 'correct-horse-battery', newPassword: 'brand-new-password' })
    expect(res.status).toBe(204)
    expect((await client.get('/api/auth/me')).status).toBe(200)
    expect((await other.get('/api/auth/me')).status).toBe(401)
  })

  it('isolates workspaces between users', async () => {
    const a = await signUp(h)
    const b = await signUp(h)
    expect((await b.client.get(`/api/workspaces/${a.workspaceId}/overview`)).status).toBe(404)
    expect((await b.client.get('/api/cards/00000000-0000-4000-8000-000000000000')).status).toBe(404)
    expect((await b.client.get('/api/cards/not-a-uuid')).status).toBe(404)
  })

  it('sends security headers', async () => {
    const res = await h.app.request('/healthz')
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })
})
