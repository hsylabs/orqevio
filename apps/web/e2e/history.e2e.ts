import { addCard, createProject, expect, openNewWorkspace, test } from './helpers'

// Every change to a page or a card is in its history, with who made it; texts show what
// changed line by line, and the history follows changes made elsewhere as they happen.
test('the history shows who changed what, and what changed line by line', async ({ page, request, baseURL }) => {
  const workspaceId = await openNewWorkspace(page, 'Historial E2E')
  await createProject(page, 'Web')
  await addCard(page, 'Por hacer', 'Escribir textos')
  const created = await page.request.post('/api/tokens', {
    data: { name: 'Claude', workspaceId, scopes: ['tasks:read', 'tasks:write', 'docs:read', 'docs:write'], expiresInDays: null },
  })
  expect(created.status(), await created.text()).toBe(201)
  const { token } = (await created.json()) as { token: string }
  const asAgent = async (method: 'patch' | 'post', path: string, data: unknown) => {
    const res = await request[method](`${baseURL}/api${path}`, { headers: { Authorization: `Bearer ${token}` }, data })
    expect(res.status(), await res.text()).toBe(200)
  }

  // A page written by a person, then by an agent.
  await page.getByRole('button', { name: 'Nueva página en Web' }).click({ force: true })
  await page.waitForURL(/\/d\//)
  const pageId = page.url().split('/d/')[1]!
  await page.getByLabel('Título de la página').fill('Guía de estilo')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Usa frases cortas.')
  await expect(page.getByText('Guardado')).toBeVisible()
  const current = (await (await page.request.get(`/api/pages/${pageId}`)).json()) as { content: string; version: number }
  await asAgent('patch', `/pages/${pageId}`, { content: `${current.content}\n\nEvita los tecnicismos.`, baseVersion: current.version })
  await expect(page.locator('.orq-prose')).toContainText('Evita los tecnicismos.')

  await page.getByRole('button', { name: 'Acciones de la página' }).click()
  await page.getByRole('menuitem', { name: 'Historial' }).click()
  const dialog = page.getByRole('dialog', { name: 'Historial de «Guía de estilo»' })
  const entries = dialog.getByRole('list', { name: 'Cambios' }).getByRole('listitem')
  await expect(entries.nth(0)).toContainText('Claude editó el contenido')
  await expect(entries.nth(0)).toContainText('vía MCP')
  await expect(dialog.getByRole('listitem').filter({ hasText: 'Lucía Martín editó el contenido' })).toBeVisible()
  await expect(dialog.getByRole('listitem').filter({ hasText: 'Lucía Martín creó esta página' })).toBeVisible()

  // The agent's change, line by line: what was there stays, what it added is marked.
  await entries.nth(0).getByRole('button', { name: 'Ver qué cambió' }).click()
  const diff = entries.nth(0).getByRole('group', { name: 'Qué cambió, línea a línea' })
  await expect(diff.locator('ins')).toContainText(['Evita los tecnicismos.'])
  await expect(diff.locator('del')).toHaveCount(0)
  await expect(diff).toContainText('Usa frases cortas.')
  await page.keyboard.press('Escape')

  // A card: renamed here, moved by the agent while its history is open.
  await page.getByRole('navigation').getByRole('link', { name: 'Tareas' }).click()
  await page.getByRole('button', { name: 'Escribir textos' }).click()
  const cardTitle = page.getByLabel('Título de la tarjeta')
  await cardTitle.fill('Escribir los textos')
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/api/cards/'))
  await cardTitle.press('Enter')
  expect((await saved).status()).toBe(200)
  const cardId = new URL(page.url()).searchParams.get('card')!
  await page.getByRole('button', { name: 'Acciones de la tarjeta' }).click()
  await page.getByRole('menuitem', { name: 'Historial' }).click()
  const cardDialog = page.getByRole('dialog', { name: 'Historial de «Escribir los textos»' })
  await expect(cardDialog.getByRole('listitem').first()).toContainText('Lucía Martín le cambió el nombre de «Escribir textos» a «Escribir los textos»')

  const board = (await (await page.request.get(`/api/cards/${cardId}`)).json()) as { boardId: string }
  const columns = ((await (await page.request.get(`/api/boards/${board.boardId}`)).json()) as { columns: Array<{ id: string; name: string }> }).columns
  await asAgent('post', `/cards/${cardId}/move`, { columnId: columns.find((c) => c.name === 'En curso')!.id, index: 0 })
  await expect(cardDialog.getByRole('listitem').first()).toContainText('Claude la movió de «Por hacer» a «En curso»')
  await expect(cardDialog.getByRole('listitem').last()).toContainText('Lucía Martín creó esta tarjeta en «Por hacer»')
})

// Only people's edits are changes: opening a page or a card and using its menus saves nothing,
// even when the editor adds its empty line after a list at the end.
test('opening a page or a card changes nothing', async ({ page }) => {
  await openNewWorkspace(page, 'Sin cambios E2E')
  const boardId = await createProject(page, 'Notas')
  const projectId = ((await (await page.request.get(`/api/boards/${boardId}`)).json()) as { projectId: string }).projectId
  const content = '# Compras\n\n- Pan\n- Leche'
  const doc = (await (await page.request.post(`/api/projects/${projectId}/pages`, { data: { title: 'Lista', content } })).json()) as { id: string }
  const columns = ((await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string }> }).columns
  const card = (await (await page.request.post(`/api/columns/${columns[0]!.id}/cards`, { data: { title: 'Recados', description: '- Correos\n- Banco' } })).json()) as { id: string }
  const writes: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'PATCH') writes.push(r.url())
  })

  // Opened from the sidebar, as people do: loading the page anew while the board's requests are on
  // their way makes WebKit report them as refused.
  await page.getByRole('navigation').getByRole('link', { name: 'Lista' }).click()
  await page.waitForURL(`**/d/${doc.id}`)
  await expect(page.locator('.orq-prose li')).toHaveCount(2)
  await page.getByRole('button', { name: 'Acciones de la página' }).click()
  await page.getByRole('menuitem', { name: 'Historial' }).click()
  await page.keyboard.press('Escape')
  await page.locator('.orq-prose li').last().click()
  await page.getByRole('navigation').getByRole('link', { name: 'Tareas' }).click()
  await page.getByRole('button', { name: 'Recados' }).click()
  await expect(page.getByRole('textbox', { name: 'Descripción de la tarjeta' }).locator('li')).toHaveCount(2)
  await page.getByRole('button', { name: 'Acciones de la tarjeta' }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('textbox', { name: 'Descripción de la tarjeta' }).locator('li').last().click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1500)

  expect(writes).toEqual([])
  expect(((await (await page.request.get(`/api/pages/${doc.id}`)).json()) as { content: string }).content).toBe(content)
  expect(((await (await page.request.get(`/api/cards/${card.id}`)).json()) as { description: string }).description).toBe('- Correos\n- Banco')
})
