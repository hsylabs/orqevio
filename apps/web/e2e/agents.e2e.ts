import { addCard, createProject, expect, openNewWorkspace, test } from './helpers'

test('an MCP agent works on the board in real time, without vault access', async ({ page, request, baseURL }) => {
  await openNewWorkspace(page, 'Agentes E2E')
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

// On a phone the page is the only scroll: the agents' activity shows the last 10 and the earlier
// ones on request, also for one access.
test('the agents activity comes 10 at a time on a phone, the earlier ones on request', async ({ page, request, baseURL }) => {
  // Everything through the API before the app opens, so the page loads once, with all of it there
  // and nothing of another page still on its way (which WebKit reports as refused).
  const created = async (path: string, data: unknown) => {
    const res = await page.request.post(path, { data })
    expect(res.status(), await res.text()).toBe(201)
    return (await res.json()) as { id: string; token?: string }
  }
  const workspaceId = (await created('/api/workspaces', { name: 'Actividad E2E' })).id
  const projectId = (await created(`/api/workspaces/${workspaceId}/projects`, { name: 'Copia de Trello' })).id
  const boardId = (await created(`/api/projects/${projectId}/boards`, { name: 'Tablero', columns: ['Por hacer'] })).id
  const board = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string }> }
  const { token } = await created('/api/tokens', { name: 'Claude', workspaceId, scopes: ['tasks:read', 'tasks:write'], expiresInDays: 30 })
  for (let i = 1; i <= 12; i++) {
    const res = await request.post(`${baseURL}/api/columns/${board.columns[0]!.id}/cards`, { headers: { Authorization: `Bearer ${token}` }, data: { title: `Copiada ${i}` } })
    expect(res.status(), await res.text()).toBe(201)
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/w/${workspaceId}/agents`)
  const activity = page.getByRole('region', { name: 'Actividad de los agentes' })
  await expect(activity.getByRole('listitem')).toHaveCount(10)
  await expect(activity.getByRole('listitem').first()).toContainText('Copiada 12')
  // A page that opens this narrow shows the MCP tools folded from the start.
  await expect(page.getByText(/^Ver las \d+ herramientas$/)).toBeVisible()
  await expect(page.getByText('list_projects')).toBeHidden()
  await activity.getByRole('button', { name: 'Ver actividad anterior' }).click()
  await expect(activity.getByRole('listitem')).toHaveCount(12)
  await expect(activity.getByRole('listitem').last()).toContainText('Copiada 1»')
  await expect(activity.getByRole('button', { name: 'Ver actividad anterior' })).toHaveCount(0)

  // The same, for one access.
  await page.getByRole('button', { name: 'Ver su actividad' }).click()
  const own = page.getByRole('region', { name: 'Actividad de «Claude»' })
  await expect(own.getByRole('listitem')).toHaveCount(10)
  await own.getByRole('button', { name: 'Ver actividad anterior' }).click()
  await expect(own.getByRole('listitem')).toHaveCount(12)
})

// Side by side, the activity and the MCP tools end at the same height and each scrolls in its own
// box. Stacked, the page is the only scroll, and the tools wait folded under the activity.
test('the MCP tools end at the height of the activity side by side, and wait folded on a phone', async ({ page }) => {
  // The workspace through the API, so the app opens once: nothing of another page is still on its
  // way when it opens, which WebKit reports as refused.
  const res = await page.request.post('/api/workspaces', { data: { name: 'Herramientas E2E' } })
  expect(res.status(), await res.text()).toBe(201)
  const { id: workspaceId } = (await res.json()) as { id: string }
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`/w/${workspaceId}/agents`)
  const activity = page.getByRole('region', { name: 'Actividad de los agentes' })
  const tools = page.getByRole('region', { name: 'Herramientas MCP' })
  await expect(activity).toContainText('Cuando un agente trabaje en este espacio')
  await expect(tools.getByText('list_projects')).toBeVisible()
  // Both boxes in the same moment: the accesses listed above them can still arrive and move them.
  const [side, other] = await activity.evaluate(
    (one, two) =>
      [one, two].map((el) => ({ top: Math.round(el.getBoundingClientRect().top), maxHeight: getComputedStyle(el).maxHeight, scrolls: el.scrollHeight > el.clientHeight })),
    await tools.elementHandle(),
  )
  expect(other!.maxHeight).not.toBe('none')
  expect(other).toEqual({ top: side!.top, maxHeight: side!.maxHeight, scrolls: true })

  // Narrowing the window folds them, without leaving the page. The same render asks for the
  // activity 10 at a time: its answer arrives before anything else is done.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(tools).toHaveCount(0)
  await expect(activity).toContainText('Cuando un agente trabaje en este espacio')
  // Narrowing the window closed the side panel, so nothing covers the tools.
  await expect(page.getByRole('button', { name: 'Alternar barra lateral' })).toHaveAttribute('aria-expanded', 'false')
  const show = page.getByText(/^Ver las \d+ herramientas$/)
  await expect(show).toBeVisible()
  await expect(page.getByText('list_projects')).toBeHidden()
  await show.click()
  await expect(page.getByText('list_projects')).toBeVisible()
  await page.getByText('Ocultar las herramientas').click()
  await expect(page.getByText('list_projects')).toBeHidden()
})
