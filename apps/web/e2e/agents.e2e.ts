import { addCard, createProject, expect, signUp, test } from './helpers'

test('an MCP agent works on the board in real time, without vault access', async ({ page, request, baseURL }) => {
  await signUp(page)
  const boardId = await createProject(page, 'Operaciones')
  await addCard(page, 'Por hacer', 'Revisar contratos')

  await page.getByRole('link', { name: 'Agentes' }).click()
  await page.getByRole('button', { name: 'Conectar un agente' }).first().click()
  await page.getByLabel('Nombre del agente').fill('Claude')
  await page.getByRole('button', { name: 'Crear token' }).click()
  const token = (await page.getByRole('dialog').locator('code').first().innerText()).trim()
  expect(token).toMatch(/^orq_/)
  await page.getByRole('button', { name: 'Hecho' }).click()

  const board = await page.evaluate(async (id) => (await fetch(`/api/boards/${id}`)).json(), boardId)
  await page.goto(`/w/${board.workspaceId}/b/${boardId}`)
  await expect(page.getByRole('region', { name: 'Columna Por hacer' })).toBeVisible()

  const rpc = (method: string, params: unknown, id = 1) =>
    request.post(`${baseURL}/mcp`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' },
      data: { jsonrpc: '2.0', id, method, params },
    })

  const tools = await (await rpc('tools/list', {})).json()
  const names: string[] = tools.result.tools.map((t: { name: string }) => t.name)
  expect(names).toContain('create_card')
  expect(names.some((n) => /vault|password/i.test(n))).toBe(false)

  await rpc('tools/call', { name: 'create_card', arguments: { column_id: board.columns[1].id, title: 'Preparar informe trimestral' } }, 2)
  const created = page.getByRole('region', { name: 'Columna En curso' }).getByRole('button', { name: 'Preparar informe trimestral' })
  await expect(created).toBeVisible()
  await expect(created).toContainText('Claude')

  // The vault refuses the token outright.
  const vault = await request.get(`${baseURL}/api/vault`, { headers: { Authorization: `Bearer ${token}` } })
  expect(vault.status()).toBe(403)

  // Activity is attributed to the agent.
  await page.getByRole('link', { name: 'Agentes' }).click()
  await expect(page.getByText('creó la tarjeta').first()).toBeVisible()
})
