import { createProject, expect, openNewWorkspace, test } from './helpers'

// The column's menu opens a field in the column itself. Once the menu has closed, the field has the
// focus, not the menu's button: what is typed goes into it, and Enter saves it.
test('renaming a column or adding a card from its menu types into the field', async ({ page }) => {
  await openNewWorkspace(page, 'Menú de columna E2E')
  await createProject(page, 'Mudanza')
  const actions = page.getByRole('button', { name: 'Acciones de Por hacer' })

  await actions.click()
  await page.getByRole('menuitem', { name: 'Renombrar' }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(page.getByLabel('Nombre de la columna')).toBeFocused()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Pendiente')
  await page.keyboard.press('Enter')
  const column = page.getByRole('region', { name: 'Columna Pendiente' })
  await expect(column).toBeVisible()

  await page.getByRole('button', { name: 'Acciones de Pendiente' }).click()
  await page.getByRole('menuitem', { name: 'Añadir tarjeta' }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(column.getByLabel('Título de la tarjeta')).toBeFocused()
  await page.keyboard.type('Pedir presupuestos')
  await page.keyboard.press('Enter')
  await expect(column.getByRole('button', { name: 'Pedir presupuestos' })).toBeVisible()
})
