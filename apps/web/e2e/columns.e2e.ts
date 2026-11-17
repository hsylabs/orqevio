import { addCard, createProject, expect, openNewWorkspace, test } from './helpers'

// Deleting a column takes its cards to the trash: the confirmation must count all of them,
// also the ones a filter hides and the archived ones, which are not on the board.
test('deleting a column says how many cards go with it, hidden or archived', async ({ page }) => {
  await openNewWorkspace(page, 'Columnas E2E')
  await createProject(page, 'Limpieza')
  await addCard(page, 'Por hacer', 'Primera tarea')
  await addCard(page, 'Por hacer', 'Segunda tarea')

  // A filter that hides every card.
  await page.getByRole('button', { name: 'Filtrar' }).click()
  await page.getByLabel('Buscar por título').fill('nada coincide con esto')
  await page.keyboard.press('Escape')
  const todo = page.getByRole('region', { name: 'Columna Por hacer' })
  await expect(todo.getByText('Nada coincide con el filtro')).toBeVisible()
  await page.getByRole('button', { name: 'Acciones de Por hacer' }).click()
  await page.getByRole('menuitem', { name: 'Eliminar columna' }).click()
  const dialog = page.getByRole('dialog', { name: /Eliminar la columna/ })
  await expect(dialog).toContainText('Sus 2 tarjetas irán con ella a la papelera.')
  await expect(dialog).toContainText('Podrás recuperarlo todo desde la papelera durante 30 días.')
  await expect(dialog).not.toContainText('La columna está vacía')
  await dialog.getByRole('button', { name: 'Cancelar' }).click()
  await page.getByRole('button', { name: 'Quitar filtro' }).click()
  await expect(todo.getByRole('button', { name: 'Primera tarea' })).toBeVisible()

  // A column whose only card is archived.
  await addCard(page, 'Hecho', 'Tarea terminada')
  await page.getByRole('button', { name: 'Tarea terminada' }).click()
  await page.getByRole('button', { name: 'Acciones de la tarjeta' }).click()
  await page.getByRole('menuitem', { name: 'Archivar' }).click()
  const done = page.getByRole('region', { name: 'Columna Hecho' })
  await expect(done.getByRole('button', { name: 'Tarea terminada' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Acciones de Hecho' }).click()
  await page.getByRole('menuitem', { name: 'Eliminar columna' }).click()
  await expect(dialog).toContainText('Su tarjeta archivada irá con ella a la papelera.')
  await expect(dialog).not.toContainText('La columna está vacía')
  await dialog.getByRole('button', { name: 'Eliminar columna' }).click()
  await expect(done).toHaveCount(0)

  // An empty column still says so.
  await page.getByRole('button', { name: 'Acciones de En curso' }).click()
  await page.getByRole('menuitem', { name: 'Eliminar columna' }).click()
  await expect(dialog).toContainText('La columna está vacía')
  await dialog.getByRole('button', { name: 'Cancelar' }).click()
})
