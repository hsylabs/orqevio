import { addCard, createProject, expect, openNewWorkspace, test } from './helpers'

test('organise work on a Kanban board', async ({ page }) => {
  await openNewWorkspace(page, 'Tareas E2E')
  await createProject(page, 'Lanzamiento web')
  await addCard(page, 'Por hacer', 'Definir el mensaje principal')
  await addCard(page, 'Por hacer', 'Diseñar la página de inicio')

  // Card details: labels, due date, description and checklist.
  await page.getByRole('button', { name: 'Diseñar la página de inicio' }).click()
  await page.getByRole('button', { name: 'Añadir etiquetas' }).click()
  await page.getByRole('button', { name: 'Crear etiqueta' }).click()
  await page.getByLabel('Nombre de la etiqueta').fill('Diseño')
  await page.getByRole('radio', { name: 'Iris' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Sin fecha' }).click()
  await page.getByRole('button', { name: 'Mañana' }).click()
  await page.getByLabel('Descripción de la tarjeta').click()
  await page.keyboard.type('Una portada que se entienda en cinco segundos.')
  await page.getByRole('button', { name: '+ Añadir' }).click()
  await page.getByRole('button', { name: 'Añadir elemento' }).click()
  await page.getByLabel('Nuevo elemento').fill('Wireframe')
  await page.keyboard.press('Enter')
  await page.getByLabel('Nuevo elemento').fill('Prototipo')
  await page.keyboard.press('Enter')
  await page.getByRole('checkbox', { name: 'Wireframe' }).click()
  await expect(page.getByText('Guardado')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  const card = page.getByRole('button', { name: 'Diseñar la página de inicio' })
  await expect(card).toContainText('Diseño')
  await expect(card).toContainText('Mañana')
  await expect(card).toContainText('1/2')

  // Drag with the pointer to another column.
  const source = page.getByRole('button', { name: 'Definir el mensaje principal' })
  const target = page.getByRole('region', { name: 'Columna En curso' })
  const a = (await source.boundingBox())!
  const b = (await target.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2, { steps: 4 })
  await page.mouse.move(b.x + b.width / 2, b.y + 70, { steps: 12 })
  await page.mouse.up()
  await expect(target.getByRole('button', { name: 'Definir el mensaje principal' })).toBeVisible()

  // Keyboard drag (accessibility): space to lift, arrow to move, space to drop.
  const moving = page.getByRole('button', { name: 'Diseñar la página de inicio' })
  await moving.focus()
  for (const key of ['Space', 'ArrowRight', 'ArrowRight', 'Space']) {
    await page.keyboard.press(key)
    await page.waitForTimeout(120)
  }
  await expect(page.getByRole('region', { name: 'Columna Hecho' }).getByRole('button', { name: 'Diseñar la página de inicio' })).toBeVisible()

  // Everything persisted.
  await page.reload()
  await expect(page.getByRole('region', { name: 'Columna En curso' }).getByRole('button', { name: 'Definir el mensaje principal' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Columna Hecho' }).getByRole('button', { name: 'Diseñar la página de inicio' })).toContainText('1/2')

  // Archive and restore.
  await page.getByRole('button', { name: 'Definir el mensaje principal' }).click()
  await page.getByRole('button', { name: 'Acciones de la tarjeta' }).click()
  await page.getByRole('menuitem', { name: 'Archivar' }).click()
  await expect(page.getByRole('region', { name: 'Columna En curso' }).getByRole('button', { name: 'Definir el mensaje principal' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Archivadas' }).click()
  await page.getByRole('button', { name: 'Restaurar' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('region', { name: 'Columna En curso' }).getByRole('button', { name: 'Definir el mensaje principal' })).toBeVisible()
})
