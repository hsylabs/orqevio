import { readFile } from 'node:fs/promises'
import { ACCESS_KEY_FILE, createProject, expect, openNewWorkspace, test } from './helpers'

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
