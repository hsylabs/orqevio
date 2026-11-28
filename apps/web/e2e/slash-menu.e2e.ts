import type { Locator, Page } from '@playwright/test'
import { createProject, expect, openNewWorkspace, test } from './helpers'

// The «/» menu as Notion's: headings 4 to 6, the last blocks chosen first as «Sugerencias», a
// footer that closes it, and a drawing of the block marked beside it, with what it is for.

async function openPage(page: Page, name: string, content: string) {
  const workspace = (await (await page.request.post('/api/workspaces', { data: { name } })).json()) as { id: string }
  const project = (await (await page.request.post(`/api/workspaces/${workspace.id}/projects`, { data: { name: 'Notas' } })).json()) as { id: string }
  const created = await page.request.post(`/api/projects/${project.id}/pages`, { data: { title: 'Plan', content } })
  expect(created.status(), await created.text()).toBe(201)
  const pageId = ((await created.json()) as { id: string }).id
  await page.goto(`/w/${workspace.id}/d/${pageId}`)
  const editor = page.getByRole('textbox', { name: 'Contenido de la página' })
  await expect(editor).toBeVisible()
  const saved = async () => ((await (await page.request.get(`/api/pages/${pageId}`)).json()) as { content: string }).content
  return { editor, saved }
}

/** Opens the «/» menu on a new line after the text given. */
async function slashAfter(page: Page, editor: Locator, text: string) {
  await editor.getByText(text, { exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  const menu = page.getByRole('listbox', { name: 'Insertar bloque' })
  await expect(menu).toBeVisible()
  return menu
}

test('headings 4 to 6 are in the «/» menu, with their shortcut, which typed makes them too', async ({ page }) => {
  const { editor, saved } = await openPage(page, 'Títulos E2E', 'Uno')
  const menu = await slashAfter(page, editor, 'Uno')
  await expect(menu.getByRole('option', { name: /Título 4/ }).locator('kbd')).toHaveText('####')
  await expect(menu.getByRole('option', { name: /Título 5/ }).locator('kbd')).toHaveText('#####')
  await expect(menu.getByRole('option', { name: /Título 6/ }).locator('kbd')).toHaveText('######')
  await menu.getByRole('option', { name: /Título 4/ }).click()
  await page.keyboard.type('Detalles')
  await expect(editor.locator('h4')).toHaveText('Detalles')
  await expect.poll(saved).toMatch(/^Uno\n\n#### Detalles\n*$/)

  // Typed at the start of a line, as the menu says.
  await page.keyboard.press('Enter')
  await page.keyboard.type('###### Nota')
  await expect(editor.locator('h6')).toHaveText('Nota')
  await expect.poll(saved).toMatch(/^Uno\n\n#### Detalles\n\n###### Nota\n*$/)

  // And in «Convertir en», for a block that is one already.
  await editor.getByText('Detalles', { exact: true }).click()
  await page.keyboard.press('ControlOrMeta+/')
  await page.getByRole('menuitem', { name: 'Convertir en' }).press('ArrowRight')
  await expect(page.getByRole('menuitem', { name: /Título 4/ })).toBeDisabled()
  await page.getByRole('menuitem', { name: /Título 5/ }).click()
  await expect.poll(saved).toMatch(/^Uno\n\n##### Detalles\n\n###### Nota\n*$/)
})

test('beside the block marked, a drawing of it and what it is for, which follows the arrows', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const { editor } = await openPage(page, 'Vista previa E2E', 'Uno')
  const menu = await slashAfter(page, editor, 'Uno')
  const preview = page.getByTestId('slash-preview')
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('Texto normal. Empieza a escribir.')
  await page.keyboard.press('ArrowDown')
  await expect(preview).toContainText('El título más grande, para las secciones principales de la página.')
  await expect(preview).toContainText('Aa')

  // On the menu's right, level with the option marked.
  const menuBox = (await menu.boundingBox())!
  const option = (await menu.getByRole('option', { name: /Título 1/ }).boundingBox())!
  const box = (await preview.boundingBox())!
  expect(box.x).toBeGreaterThan(menuBox.x + menuBox.width)
  expect(Math.abs(box.y - option.y)).toBeLessThan(12)
  await page.screenshot({ path: testInfo.outputPath('slash-preview-h1.png') })

  // With the pointer too.
  await menu.getByRole('option', { name: /Lista de tareas/ }).hover()
  await expect(preview).toContainText('Una lista de tareas, cada una con su casilla para marcarla al terminar.')
  await menu.getByRole('option', { name: /Tabla/ }).hover()
  await expect(preview).toContainText('Filas y columnas, con una fila de cabecera.')
  await page.screenshot({ path: testInfo.outputPath('slash-preview-table.png') })
  // Drawings are left out of what is read: the menu says it already.
  await expect(preview).toHaveAttribute('aria-hidden', 'true')
})

test('the last blocks chosen come first as «Sugerencias», until something is typed', async ({ page }, testInfo) => {
  const { editor } = await openPage(page, 'Sugerencias E2E', 'Uno')
  let menu = await slashAfter(page, editor, 'Uno')
  await expect(menu).not.toContainText('Sugerencias')
  await menu.getByRole('option', { name: /Lista de tareas/ }).click()
  await page.keyboard.type('Cajas')
  menu = await slashAfter(page, editor, 'Uno')
  await page.keyboard.type('separ')
  await page.keyboard.press('Enter')
  await expect(editor.locator('hr')).toHaveCount(1)

  menu = await slashAfter(page, editor, 'Uno')
  await expect(menu.getByText('Sugerencias')).toBeVisible()
  const options = menu.getByRole('option')
  // The latest first, and each also in its place.
  await expect(options.nth(0)).toContainText('Separador')
  await expect(options.nth(1)).toContainText('Lista de tareas')
  await expect(options.nth(2)).toContainText('Texto')
  await expect(menu.getByRole('option', { name: /Separador/ })).toHaveCount(2)
  await page.screenshot({ path: testInfo.outputPath('slash-suggestions.png') })
  // Typed, only what matches.
  await page.keyboard.type('sep')
  await expect(menu.getByText('Sugerencias')).toHaveCount(0)
  await expect(menu.getByRole('option', { name: /Separador/ })).toHaveCount(1)
})

test('«Cerrar menú» at its foot closes it as Esc does, leaving what was typed', async ({ page }) => {
  const { editor, saved } = await openPage(page, 'Cerrar E2E', 'Uno')
  const menu = await slashAfter(page, editor, 'Uno')
  const close = page.getByRole('button', { name: /Cerrar menú/ })
  await expect(close).toContainText('Esc')
  await close.click()
  await expect(menu).toBeHidden()
  await expect(editor).toBeFocused()
  await expect.poll(saved).toBe('Uno\n\n/')
  // Over: Enter makes a new line, rather than the block that was marked.
  await page.keyboard.press('Enter')
  await page.keyboard.type('Dos')
  await expect(editor.locator(':scope > p')).toHaveCount(3)
  await expect.poll(saved).toBe('Uno\n\n/\n\nDos')
})

test('in a card’s sheet, the menu takes the pointer as well', async ({ page }) => {
  const workspaceId = await openNewWorkspace(page, 'Menú en ficha E2E')
  const boardId = await createProject(page, 'Notas')
  const columns = ((await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string }> }).columns
  const card = (await (await page.request.post(`/api/columns/${columns[0]!.id}/cards`, { data: { title: 'Mudanza' } })).json()) as { id: string }
  await page.goto(`/w/${workspaceId}/b/${boardId}?card=${card.id}`)
  const box = page.getByRole('textbox', { name: 'Nuevo comentario' })
  await box.click()
  await page.keyboard.type('/')
  const menu = page.getByRole('listbox', { name: 'Insertar bloque' })
  await menu.getByRole('option', { name: /Lista de tareas/ }).hover()
  await expect(page.getByTestId('slash-preview')).toContainText('Una lista de tareas')
  await menu.getByRole('option', { name: /Lista de tareas/ }).click()
  await expect(box.getByRole('checkbox')).toHaveCount(1)
  await page.keyboard.type('Cajas /')
  await page.getByRole('button', { name: /Cerrar menú/ }).click()
  await expect(menu).toBeHidden()
})

test.describe('on a phone', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

  test('the menu has no room for the drawing beside it, and shows none', async ({ page }, testInfo) => {
    const { editor } = await openPage(page, 'Vista previa móvil E2E', 'Uno')
    await editor.getByText('Uno', { exact: true }).tap()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/')
    const menu = page.getByRole('listbox', { name: 'Insertar bloque' })
    await expect(menu).toBeVisible()
    await expect(page.getByTestId('slash-preview')).toBeHidden()
    await expect(page.getByRole('button', { name: /Cerrar menú/ })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('slash-phone.png') })
  })
})
