import { readFile } from 'node:fs/promises'
import { ACCESS_KEY_FILE, addCard, createProject, expect, openNewWorkspace, test } from './helpers'

// A dialog opened from a menu gives the focus back to the menu's button when it closes, not to
// the page: the menu item that opened it is gone by then.
test('the focus goes back to the menu button after a dialog opened from it', async ({ page }) => {
  await openNewWorkspace(page, 'Foco de vuelta')
  await createProject(page, 'Diálogos')
  const menu = page.getByRole('button', { name: 'Acciones del tablero' })
  await menu.click()
  await page.getByRole('menuitem', { name: 'Renombrar tablero' }).click()
  await expect(page.getByRole('dialog', { name: 'Renombrar tablero' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(menu).toBeFocused()
})

// Opened with a button, a dialog, the palette or a card's sheet gives the focus back to that button
// when it closes, not to the page; the sheet takes the focus itself, so Tab goes on inside it.
test('the focus goes back to the button that opened a dialog, the palette or a card', async ({ page }) => {
  await openNewWorkspace(page, 'Foco que vuelve')
  await createProject(page, 'Diálogos')
  const sidebar = page.getByRole('navigation', { name: 'Navegación principal' })

  const newProject = sidebar.getByRole('button', { name: 'Nuevo proyecto' })
  await newProject.click()
  await expect(page.getByRole('dialog', { name: 'Nuevo proyecto' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(newProject).toBeFocused()

  const search = sidebar.getByRole('button', { name: /Buscar o saltar a/ })
  await search.click()
  await expect(page.getByRole('dialog', { name: 'Buscar' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(search).toBeFocused()

  await addCard(page, 'Por hacer', 'Llamar al proveedor')
  const card = page.getByRole('region', { name: 'Columna Por hacer' }).getByRole('button', { name: 'Llamar al proveedor' })
  await card.click()
  const sheet = page.getByRole('dialog', { name: 'Llamar al proveedor' })
  await expect(sheet).toBeFocused()
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(card).toBeFocused()
})

// With many workspaces the workspace menu is taller than the window: it scrolls, and what is at
// its end can still be reached.
test('a long menu scrolls, and its last items can be reached', async ({ page }) => {
  await openNewWorkspace(page, 'Menú largo')
  for (let i = 1; i <= 40; i++) expect((await page.request.post('/api/workspaces', { data: { name: `Espacio ${i}` } })).status()).toBe(201)
  await page.reload()
  await page.getByRole('button', { name: /^Menú largo/ }).click()
  await page.getByRole('menuitem', { name: 'Nuevo espacio' }).click()
  await expect(page.getByRole('dialog', { name: 'Nuevo espacio' })).toBeVisible()
  await page.keyboard.press('Escape')
})

// New → Login in the vault: the cursor is in the name of the new item.
test('a new vault item from the New menu starts with the cursor in its name', async ({ page }) => {
  const accessKey = (await readFile(ACCESS_KEY_FILE, 'utf8')).trim()
  expect((await page.request.post('/api/vault/reset', { data: { accessKey } })).status()).toBe(204)
  await openNewWorkspace(page, 'Foco en la bóveda')
  await page.getByRole('link', { name: /^Bóveda/ }).click()
  await page.getByLabel('Contraseña maestra', { exact: true }).fill('frase maestra larga de prueba')
  await page.getByLabel('Repite la contraseña maestra').fill('frase maestra larga de prueba')
  await page.getByRole('button', { name: 'Crear bóveda' }).click()
  await page.getByLabel('La he guardado en un lugar seguro, fuera de Orqevio.').check({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Abrir mi bóveda' }).click()
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Credencial' }).click()
  await expect(page.getByLabel('Nombre')).toBeFocused()
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  // Closed, the sidebar is off the screen: Tab and screen readers skip it. Long titles on Home are
  // cut, and the due dates beside them stay on the screen.
  test('the closed sidebar is skipped, and Home keeps long titles within the screen', async ({ page }) => {
    // Everything through the API before the app opens, so the page loads once with all of it.
    const created = async (path: string, data: unknown) => {
      const res = await page.request.post(path, { data })
      expect(res.status(), await res.text()).toBe(201)
      return ((await res.json()) as { id: string }).id
    }
    const workspaceId = await created('/api/workspaces', { name: 'Inicio estrecho' })
    const projectId = await created(`/api/workspaces/${workspaceId}/projects`, { name: 'Local' })
    const boardId = await created(`/api/projects/${projectId}/boards`, { name: 'Trámites', columns: ['Por hacer'] })
    const board = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string }> }
    const long = 'Revisar con la asesoría el contrato de alquiler del local de la calle Mayor antes de firmar la renovación anual'
    await created(`/api/columns/${board.columns[0]!.id}/cards`, { title: long, dueAt: new Date(Date.now() + 86_400_000).toISOString() })
    await created(`/api/projects/${projectId}/pages`, { title: `Notas de la reunión: ${long}` })

    await page.goto(`/w/${workspaceId}`)
    const due = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Vencen pronto' }) }).getByRole('link')
    await expect(due).toContainText('Revisar con la asesoría')
    const sizes = await due.evaluate((link) => {
      const chip = link.lastElementChild!.getBoundingClientRect()
      return { chipRight: chip.right, chipWidth: chip.width, screen: window.innerWidth, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }
    })
    expect(sizes.chipWidth).toBeGreaterThan(0)
    expect(sizes.chipRight).toBeLessThanOrEqual(sizes.screen)
    expect(sizes.overflow).toBe(0)
    const recent = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Documentos recientes' }) }).getByRole('link').first()
    expect(await recent.evaluate((link) => link.getBoundingClientRect().right)).toBeLessThanOrEqual(390)

    // Tab never lands in the closed sidebar.
    const inSidebar: string[] = []
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab')
      const where = await page.evaluate(() => (document.activeElement?.closest('nav[aria-label="Navegación principal"]') ? document.activeElement.textContent?.trim() || document.activeElement.getAttribute('aria-label') : null))
      if (where) inSidebar.push(where)
    }
    expect(inSidebar).toEqual([])
    // Opened, it is there again.
    await page.getByRole('button', { name: 'Alternar barra lateral' }).click()
    await expect(page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: 'Papelera' })).toBeVisible()
  })

  // Buttons that show only their icon on a phone still say what they do.
  test('icon buttons keep their names', async ({ page }) => {
    const workspaceId = await openNewWorkspace(page, 'Botones con nombre')
    const project = await page.request.post(`/api/workspaces/${workspaceId}/projects`, { data: { name: 'Móvil', color: 'tomato' } })
    const { id: projectId } = (await project.json()) as { id: string }
    const board = (await (await page.request.post(`/api/projects/${projectId}/boards`, { data: { name: 'Tablero' } })).json()) as { id: string }
    // The sidebar already read the empty workspace.
    await page.reload()
    await page.getByRole('button', { name: 'Alternar barra lateral' }).click()
    await page.getByRole('navigation').getByRole('link', { name: 'M Móvil' }).click()
    await expect(page.getByRole('button', { name: 'Editar', exact: true })).toBeVisible()
    await page.getByRole('main').getByRole('link', { name: /Tablero/ }).first().click()
    await page.waitForURL(`**/b/${board.id}`)
    await expect(page.getByRole('button', { name: 'Filtrar' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Archivadas' })).toBeVisible()
  })
})

// A board reads as headings and lists, and a card says its labels and due date as well as its title.
test('the board has headings and lists, and a card says its labels and due date', async ({ page }, testInfo) => {
  await openNewWorkspace(page, 'Lectura E2E')
  const boardId = await createProject(page, 'Lecturas')
  const board = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { name: string; columns: Array<{ id: string; name: string }> }
  const label = (await (await page.request.post(`/api/boards/${boardId}/labels`, { data: { name: 'Urgente', color: 'amber' } })).json()) as { id: string }
  await page.request.post(`/api/columns/${board.columns[0]!.id}/cards`, { data: { title: 'Leer el contrato', labelIds: [label.id], dueAt: '2031-03-14' } })
  await expect(page.getByRole('heading', { level: 1, name: board.name })).toBeAttached()
  for (const column of board.columns) await expect(page.getByRole('heading', { level: 2, name: column.name })).toBeAttached()
  const cards = page.getByRole('list', { name: `Tarjetas de ${board.columns[0]!.name}` })
  await expect(cards.getByRole('listitem')).toHaveCount(1)
  const card = cards.getByRole('listitem').getByRole('button', { name: 'Leer el contrato' })
  await expect(card).toHaveAccessibleDescription(/Etiquetas: Urgente\. Fecha límite: .*14/)
  await page.screenshot({ path: testInfo.outputPath('2-tablero.png'), animations: 'disabled' })
})

// Names and states a screen reader needs: the sidebar button says whether it is open, the current
// workspace is marked, the notices are named in Spanish, and the lines a change added are read.
test('the sidebar button says if it is open, the current workspace is marked, notices and history are read', async ({ page }) => {
  await openNewWorkspace(page, 'Estados E2E')
  await expect(page.getByRole('region', { name: /^Avisos/ })).toBeAttached()
  await page.getByRole('button', { name: /^Estados E2E/ }).click()
  await expect(page.getByRole('menuitem', { name: /Estados E2E/ })).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('Escape')

  await createProject(page, 'Notas')
  await page.getByRole('button', { name: 'Nueva página en Notas' }).click({ force: true })
  await page.waitForURL(/\/d\//)
  await page.getByLabel('Título de la página').fill('Acta')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Primera línea')
  await expect(page.getByText('Guardado')).toBeVisible()
  await page.getByRole('button', { name: 'Acciones de la página' }).click()
  await page.getByRole('menuitem', { name: 'Historial' }).click()
  const history = page.getByRole('dialog', { name: /Historial de/ })
  await expect(history.getByText(/Líneas añadidas: 1\. Líneas quitadas: 0\./)).toBeAttached()
  await page.keyboard.press('Escape')

  await page.setViewportSize({ width: 390, height: 844 })
  // At this width the sidebar starts closed, or is closed with Escape (it stays open as an overlay after a resize).
  if (await page.getByRole('navigation', { name: 'Navegación principal' }).isVisible()) await page.keyboard.press('Escape')
  const toggle = page.getByRole('button', { name: 'Alternar barra lateral' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
})

// On a phone, the palette's search takes the line, "with archived" goes under it, and nothing is cut.
test('on a phone the palette keeps its search whole', async ({ page }, testInfo) => {
  await openNewWorkspace(page, 'Paleta E2E')
  await page.setViewportSize({ width: 390, height: 844 })
  if (await page.getByRole('navigation', { name: 'Navegación principal' }).isVisible()) await page.keyboard.press('Escape')
  await page.keyboard.press('ControlOrMeta+k')
  const input = page.getByRole('combobox')
  await expect(input).toBeVisible()
  const field = (await input.boundingBox())!
  const archived = (await page.getByText('Incluir archivadas').boundingBox())!
  expect(field.width).toBeGreaterThan(250)
  expect(archived.y).toBeGreaterThanOrEqual(field.y + field.height - 2)
  await page.screenshot({ path: testInfo.outputPath('3-paleta-en-el-telefono.png'), animations: 'disabled' })
})
