import { addCard, createProject, expect, openNewWorkspace, test } from './helpers'

// An agent allowed to delete and move reorganises a project; the person undoes it all from the
// history, and turns the permission off for that agent in Agents.
test('an agent reorganises a project with permission to delete and move, and the person undoes it', async ({ page, request, baseURL }) => {
  await openNewWorkspace(page, 'Reorganizar E2E')
  const boardId = await createProject(page, 'Mudanza')
  await addCard(page, 'Por hacer', 'Cajas de la cocina')
  const board = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { projectId: string; cards: Array<{ id: string }> }
  const cardId = board.cards[0]!.id
  const archive = (await (await page.request.post(`/api/projects/${board.projectId}/boards`, { data: { name: 'Archivo' } })).json()) as { id: string }
  const archiveBoard = (await (await page.request.get(`/api/boards/${archive.id}`)).json()) as { columns: Array<{ id: string; name: string }> }
  const label = (await (await page.request.post(`/api/boards/${boardId}/labels`, { data: { name: 'Frágil', color: 'tomato' } })).json()) as { id: string }
  expect((await page.request.patch(`/api/cards/${cardId}`, { data: { labelIds: [label.id] } })).status()).toBe(200)
  const doc = (await (await page.request.post(`/api/projects/${board.projectId}/pages`, { data: { title: 'Inventario', content: 'Platos' } })).json()) as { id: string }

  // New tokens can delete and move unless the person says otherwise; here it also writes documents.
  await page.getByRole('link', { name: 'Agentes' }).click()
  await page.getByRole('button', { name: 'Conectar un agente' }).first().click()
  await page.getByLabel('Nombre del agente').fill('Claude')
  await page.getByRole('radiogroup', { name: 'Acceso a Documentos' }).getByRole('radio', { name: 'Leer y escribir' }).click()
  await expect(page.getByRole('checkbox', { name: 'Puede borrar y mover' })).toBeChecked()
  await page.getByRole('button', { name: 'Crear token' }).click()
  const token = (await page.getByRole('dialog').locator('code').first().innerText()).trim()
  await page.getByRole('button', { name: 'Hecho' }).click()
  const card = page.locator('article').filter({ hasText: 'Claude' })
  await expect(card.getByText('Borrar y mover', { exact: true })).toBeVisible()

  let id = 1
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await request.post(`${baseURL}/mcp`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' },
      data: { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } },
    })
    const body = await res.json()
    expect(body.result?.isError, JSON.stringify(body)).toBeFalsy()
    return JSON.parse(body.result.content[0].text)
  }
  const tools = async () => {
    const res = await request.post(`${baseURL}/mcp`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' }, data: { jsonrpc: '2.0', id: ++id, method: 'tools/list' } })
    return ((await res.json()).result.tools as Array<{ name: string }>).map((t) => t.name)
  }

  // With the card open on its board, the agent attaches a list, files it in the inventory, takes the
  // card to the archive and deletes the page.
  await page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: /^Tareas/ }).click()
  await page.waitForURL(`**/b/${boardId}`)
  await page.getByRole('region', { name: 'Columna Por hacer' }).getByRole('button', { name: 'Cajas de la cocina' }).click()
  await expect(page.getByLabel('Título de la tarjeta')).toHaveValue('Cajas de la cocina')
  const uploaded = await call('upload_attachment', { card_id: cardId, filename: 'lista.txt', content: 'Platos\nVasos' })
  const read = await request.post(`${baseURL}/mcp`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'read_attachment', arguments: { attachment_id: uploaded.attachment.id } } },
  })
  expect((await read.json()).result.content[1]).toEqual({ type: 'text', text: 'Platos\nVasos' })
  await call('move_attachment', { attachment_id: uploaded.attachment.id, page_id: doc.id })
  await call('move_card', { card_id: cardId, column_id: archiveBoard.columns.find((c) => c.name === 'Hecho')!.id })
  expect((await call('delete_page', { page_id: doc.id })).deleted).toBe(true)

  // The open card follows it to the archive, with that board's columns; its history tells what
  // happened, and the person undoes it all.
  await page.waitForURL(`**/b/${archive.id}?card=${cardId}`)
  await expect(page.getByRole('dialog', { name: 'Cajas de la cocina' }).getByRole('button', { name: 'Hecho' })).toBeVisible()
  await page.getByRole('button', { name: 'Acciones de la tarjeta' }).click()
  await page.getByRole('menuitem', { name: 'Historial' }).click()
  const history = page.getByRole('dialog', { name: /^Historial de/ })
  await expect(history.getByRole('listitem').filter({ hasText: 'y le quitó la etiqueta «Frágil», que era del otro tablero' })).toBeVisible()
  await expect(history.getByRole('listitem').filter({ hasText: 'Claude movió el archivo «lista.txt» de «Cajas de la cocina» a «Inventario»' })).toBeVisible()
  await history.getByRole('listitem').filter({ hasText: 'Claude adjuntó «lista.txt»' }).getByRole('button', { name: 'Deshacer todo lo que hizo Claude desde aquí' }).click()
  const confirm = page.getByRole('dialog', { name: '¿Deshacer 4 cambios de Claude?' })
  await confirm.getByRole('button', { name: 'Deshacer 4 cambios' }).click()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Se han deshecho 4 cambios' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  // Everything is as before: the card on its board with its label, the page back, the file in the trash.
  await page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: /^Tareas/ }).click()
  await page.waitForURL(`**/b/${boardId}`)
  const back = page.getByRole('region', { name: 'Columna Por hacer' }).getByRole('button', { name: 'Cajas de la cocina' })
  await expect(back).toBeVisible()
  await expect(back).toContainText('Frágil')
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Inventario' })).toBeVisible()
  const restored = (await (await page.request.get(`/api/cards/${cardId}`)).json()) as { attachmentList: unknown[] }
  expect(restored.attachmentList).toEqual([])
  expect((await (await page.request.get(`/api/pages/${doc.id}`)).json()).attachments).toEqual([])

  // The person takes the permission away: the tools to delete disappear for that agent.
  expect(await tools()).toContain('delete_card')
  await page.getByRole('link', { name: 'Agentes' }).click()
  await card.getByRole('checkbox', { name: 'Puede borrar y mover' }).click()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Claude ya no puede borrar ni mover' })).toBeVisible()
  await expect(card.getByText('Borrar y mover', { exact: true })).toHaveCount(0)
  await expect(card.getByRole('checkbox', { name: 'Puede borrar y mover' })).not.toBeChecked()
  const left = await tools()
  expect(left).not.toContain('delete_card')
  expect(left).toContain('move_card')
})
