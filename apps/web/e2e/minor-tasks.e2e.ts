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

// Signing in with a `next` whose path starts with two slashes goes home, not to an error screen.
test('a next that would read as another site leads home after signing in, not to an error', async ({ page }) => {
  const workspaceId = await openNewWorkspace(page, 'Siguiente E2E')
  for (const next of ['/.//evil.example/', '/w/../..//evil.example']) {
    // In the app, as a link would: a new load here races the requests still in flight in WebKit.
    await page.evaluate((path) => window.history.pushState(null, '', path), `/login?next=${encodeURIComponent(next)}`)
    await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')))
    await page.waitForURL((url) => url.pathname !== '/login')
    expect(new URL(page.url()).host).not.toContain('evil')
    await expect(page.getByText('External navigation is not allowed')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Nuevo proyecto' }).first()).toBeVisible()
    expect(new URL(page.url()).pathname).toMatch(new RegExp(`^/(w/${workspaceId})?$`))
  }
})

// Names that start with an emoji: the tiles of the workspace and the project show the whole emoji.
test('a workspace and a project whose names start with an emoji show it whole on their tiles', async ({ page }, testInfo) => {
  await openNewWorkspace(page, '🚀 Cohetes')
  await createProject(page, '🎨 Diseño')
  const halves = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|\uFFFD/
  const sidebar = page.getByRole('navigation')
  const link = sidebar.getByRole('link', { name: /Diseño/ }).first()
  await expect(link.locator('.glyph')).toHaveText('🎨')
  await link.click()
  await expect(page.getByRole('heading', { name: '🎨 Diseño' })).toBeVisible()
  await expect(page.locator('main .glyph').first()).toHaveText('🎨')
  await page.getByRole('button', { name: /^🚀 Cohetes/ }).click()
  await expect(page.getByRole('menuitem', { name: /🚀 Cohetes/ }).locator('.glyph')).toHaveText('🚀')
  for (const text of await page.locator('.glyph').allTextContents()) expect(text, JSON.stringify(text)).not.toMatch(halves)
  await page.screenshot({ path: testInfo.outputPath('1-emoji-en-los-iconos.png'), animations: 'disabled' })
  await page.keyboard.press('Escape')
})

// A label without a name: the card's history and the notice of its deletion say it has none.
test('a label without a name is told as such in the history and when deleted', async ({ page }, testInfo) => {
  await openNewWorkspace(page, 'Etiquetas E2E')
  const boardId = await createProject(page, 'Sin nombres')
  await addCard(page, 'Por hacer', 'Tarjeta con etiqueta')
  const created = await page.request.post(`/api/boards/${boardId}/labels`, { data: { name: '', color: 'lime' } })
  expect(created.status()).toBe(201)
  const label = (await created.json()) as { id: string }
  await page.getByRole('button', { name: 'Tarjeta con etiqueta' }).click()
  const sheet = page.getByRole('dialog', { name: 'Tarjeta con etiqueta' })
  await expect(sheet).toBeVisible()
  const cardId = new URL(page.url()).searchParams.get('card')!
  expect((await page.request.patch(`/api/cards/${cardId}`, { data: { labelIds: [label.id] } })).status()).toBe(200)
  await expect(sheet.getByRole('button', { name: 'Sin nombre' })).toBeVisible()

  await sheet.getByRole('button', { name: 'Acciones de la tarjeta' }).click()
  await page.getByRole('menuitem', { name: 'Historial' }).click()
  const history = page.getByRole('dialog', { name: 'Historial de «Tarjeta con etiqueta»' })
  await expect(history.getByRole('listitem').first()).toContainText('puso la etiqueta (sin nombre)')
  await expect(history).not.toContainText('«»')
  await history.screenshot({ path: testInfo.outputPath('2-historial-etiqueta-sin-nombre.png'), animations: 'disabled' })
  await page.keyboard.press('Escape')
  await expect(history).toHaveCount(0)

  await sheet.getByRole('button', { name: 'Sin nombre' }).click()
  await page.getByRole('button', { name: 'Editar etiqueta' }).click()
  await page.getByRole('button', { name: 'Eliminar' }).click()
  await expect(page.getByText('Etiqueta sin nombre movida a la papelera')).toBeVisible()
  await expect(page.getByText('Etiqueta «» movida a la papelera')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('3-aviso-etiqueta-sin-nombre.png'), animations: 'disabled' })
})
