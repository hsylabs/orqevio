import { addCard, createProject, expect, openNewWorkspace, test } from './helpers'

// "New workspace" opens from a menu: the name field must keep the focus the menu hands back.
test('a new workspace asks for its name with the cursor already in it', async ({ page }) => {
  await openNewWorkspace(page, 'Foco E2E')
  await page.getByRole('button', { name: /^Foco E2E/ }).click()
  await page.getByRole('menuitem', { name: 'Nuevo espacio' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nuevo espacio' })
  await expect(dialog.getByLabel('Nombre')).toBeFocused()
  await page.keyboard.type('Escrito sin hacer clic')
  await expect(dialog.getByLabel('Nombre')).toHaveValue('Escrito sin hacer clic')
})

// A card open here whose column is deleted elsewhere, with the cards in it, says it is gone.
test('an open card says it is gone when its column is deleted elsewhere', async ({ page, consoleErrors }, testInfo) => {
  await openNewWorkspace(page, 'Columna E2E')
  const boardId = await createProject(page, 'Columnas')
  await addCard(page, 'Por hacer', 'Tarjeta de una columna borrada')
  await page.getByRole('button', { name: 'Tarjeta de una columna borrada' }).click()
  const sheet = page.getByRole('dialog', { name: 'Tarjeta de una columna borrada' })
  await expect(sheet).toBeVisible()

  const { columns } = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string; name: string }> }
  const todo = columns.find((c) => c.name === 'Por hacer')!
  const deleted = await page.request.delete(`/api/columns/${todo.id}`)
  expect(deleted.status()).toBe(200)

  await expect(sheet.getByText('Esta tarjeta ya no existe')).toBeVisible()
  await sheet.screenshot({ path: testInfo.outputPath('1-tarjeta-de-columna-borrada.png'), animations: 'disabled' })

  // Back from the trash, with its column: the sheet shows it again.
  const { trashId } = (await deleted.json()) as { trashId: string }
  expect((await page.request.post(`/api/trash/${trashId}/restore`)).status()).toBe(200)
  await expect(sheet.getByText('Esta tarjeta ya no existe')).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: /Por hacer/ })).toBeVisible()
  // Asking for it again is how the sheet learns it is gone.
  const gone = /status of 404/
  consoleErrors.splice(0, consoleErrors.length, ...consoleErrors.filter((e) => !gone.test(e)))
})

// A board holds up to 20 columns: past that, there is no button to add one.
test('a board with 20 columns offers no button to add another', async ({ page }) => {
  await openNewWorkspace(page, 'Límite E2E')
  const boardId = await createProject(page, 'Muchas columnas')
  const { columns } = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: unknown[] }
  for (let i = columns.length; i < 19; i++) {
    expect((await page.request.post(`/api/boards/${boardId}/columns`, { data: { name: `Columna ${i + 1}` } })).status()).toBe(201)
  }
  await expect(page.getByRole('button', { name: 'Añadir columna' })).toBeVisible()
  expect((await page.request.post(`/api/boards/${boardId}/columns`, { data: { name: 'Columna 20' } })).status()).toBe(201)
  await expect(page.getByRole('region', { name: 'Columna Columna 20' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Añadir columna' })).toHaveCount(0)
  const extra = await page.request.post(`/api/boards/${boardId}/columns`, { data: { name: 'Columna 21' } })
  expect(extra.status()).toBe(400)
  expect(((await extra.json()) as { error: { code: string } }).error.code).toBe('too_many_columns')
})
