import { createHash, randomBytes } from 'node:crypto'
import { expect, openNewWorkspace, test } from './helpers'

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'

test('a client that only speaks OAuth connects once the owner approves it, and stops when revoked', async ({ page, request, baseURL }) => {
  const workspaceId = await openNewWorkspace(page, 'OAuth E2E')

  // Discovery, as Claude does it: a 401 on /mcp points to the metadata.
  const unauthorized = await request.post(`${baseURL}/mcp`, { data: { jsonrpc: '2.0', id: 1, method: 'initialize' } })
  expect(unauthorized.status()).toBe(401)
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(unauthorized.headers()['www-authenticate'] ?? '')?.[1]
  expect(metadataUrl).toBeTruthy()
  const resource = await (await request.get(metadataUrl!)).json()
  const server = await (await request.get(`${resource.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json()
  const registration = await request.post(server.registration_endpoint, { data: { client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' } })
  expect(registration.status()).toBe(201)
  const { client_id: clientId } = await registration.json()

  // After the decision the browser goes back to Claude; answer for it here.
  await page.route('https://claude.ai/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Claude</title>' }))

  /** The owner approves on the consent screen (read access to tasks only); returns the tokens Claude gets. */
  async function connect({ reconnecting }: { reconnecting: boolean }) {
    const verifier = randomBytes(32).toString('base64url')
    const authorize = new URL(server.authorization_endpoint)
    for (const [key, value] of Object.entries({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      scope: resource.scopes_supported.join(' '),
      resource: resource.resource,
      state: 'e2e-state',
    })) {
      authorize.searchParams.set(key, value)
    }
    await page.goto(authorize.toString())
    await expect(page.getByRole('heading', { name: 'Conectar Claude' })).toBeVisible()
    await expect(page.getByText('Al terminar volverás a claude.ai')).toBeVisible()
    await expect(page.getByText(/Se ha registrado sola/)).toBeVisible()
    await page.getByLabel('Espacio').selectOption({ label: 'OAuth E2E' })
    if (reconnecting) {
      // Claude already has access here: by default, the new access replaces it.
      await expect(page.getByText(/Claude ya tiene acceso a este espacio/)).toBeVisible()
      await expect(page.getByLabel('Sustituir el acceso anterior')).toBeChecked()
    } else {
      await expect(page.getByText(/ya tiene acceso/)).toHaveCount(0)
    }
    // It asked for everything; the owner gives it read access to tasks only.
    await page.getByRole('radiogroup', { name: 'Acceso a Tareas' }).getByRole('radio', { name: 'Leer', exact: true }).click()
    await page.getByRole('radiogroup', { name: 'Acceso a Documentos' }).getByRole('radio', { name: 'Sin acceso' }).click()
    await page.getByRole('button', { name: 'Permitir acceso' }).click()
    await page.waitForURL(/^https:\/\/claude\.ai\//)
    const back = new URL(page.url())
    expect(back.searchParams.get('state')).toBe('e2e-state')
    expect(back.searchParams.get('iss')).toBe(server.issuer)

    const exchange = await request.post(server.token_endpoint, {
      form: { grant_type: 'authorization_code', code: back.searchParams.get('code')!, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT, resource: resource.resource },
    })
    expect(exchange.status()).toBe(200)
    const tokens = await exchange.json()
    expect(tokens.scope).toBe('tasks:read')
    return tokens as { access_token: string }
  }

  const tools = (accessToken: string) =>
    request.post(`${baseURL}/mcp`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json, text/event-stream' },
      data: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    })
  const first = await connect({ reconnecting: false })
  const names = ((await (await tools(first.access_token)).json()).result.tools as Array<{ name: string }>).map((t) => t.name)
  expect(names).toContain('get_board')
  expect(names).not.toContain('create_card')
  expect(names).not.toContain('read_page')

  // Disconnecting and connecting Claude again leaves one access, not two.
  const second = await connect({ reconnecting: true })
  expect((await tools(first.access_token)).status()).toBe(401)
  expect((await tools(second.access_token)).status()).toBe(200)

  // The access is listed in «Agentes», and revoking it there cuts the application off.
  await page.goto(`/w/${workspaceId}/agents`)
  const card = page.getByRole('article').filter({ hasText: 'Conectado con OAuth' })
  await expect(card).toHaveCount(1)
  await expect(card.getByText('Tareas: Lectura')).toBeVisible()
  await card.getByRole('button', { name: 'Revocar' }).click()
  await page.getByRole('button', { name: 'Revocar acceso' }).click()
  await expect(page.getByText('Acceso revocado')).toBeVisible()
  expect((await tools(second.access_token)).status()).toBe(401)
})

test('an application asking to return somewhere it did not register is turned away', async ({ page, request, baseURL }) => {
  const registration = await request.post(`${baseURL}/oauth/register`, { data: { client_name: 'Claude', redirect_uris: [REDIRECT] } })
  const { client_id: clientId } = await registration.json()
  const authorize = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: 'https://evil.example/callback', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' })
  await page.goto(`/oauth/authorize?${authorize}`)
  await expect(page.getByRole('heading', { name: 'No se puede conectar esta aplicación' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('no pertenece a esta aplicación')
})
