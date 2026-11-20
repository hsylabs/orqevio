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
