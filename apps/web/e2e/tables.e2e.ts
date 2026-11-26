import type { Page } from '@playwright/test'
import { createProject, expect, openNewWorkspace, test } from './helpers'

// Editing a table as in Notion: a bar above it, a handle on each row and column, a «+» at the
// edges. What they make is a Markdown table, the same one agents and GitHub read.
const TABLE = ['| Fruta | Precio |', '| ----- | -----: |', '| Pera  | 2      |', '| Uva   | 3      |'].join('\n')

async function openTable(page: Page, name: string, content = `Antes\n\n${TABLE}\n\nDespués`) {
  const workspace = (await (await page.request.post('/api/workspaces', { data: { name } })).json()) as { id: string }
  const project = (await (await page.request.post(`/api/workspaces/${workspace.id}/projects`, { data: { name: 'Notas' } })).json()) as { id: string }
  const created = await page.request.post(`/api/projects/${project.id}/pages`, { data: { title: 'Precios', content } })
  expect(created.status(), await created.text()).toBe(201)
  const pageId = ((await created.json()) as { id: string }).id
  await page.goto(`/w/${workspace.id}/d/${pageId}`)
  const editor = page.getByRole('textbox', { name: 'Contenido de la página' })
  await expect(editor.locator('table')).toBeVisible()
  const saved = async () => ((await (await page.request.get(`/api/pages/${pageId}`)).json()) as { content: string }).content
  /** The table as saved: its rows, each as its cells, the delimiter row left out. */
  const rows = async () =>
    (await saved())
      .split('\n')
      .filter((line) => line.startsWith('|') && !/^\|[\s:|-]+\|$/.test(line))
      .map((line) => line.slice(1, -1).split('|').map((cell) => cell.trim()))
  return { editor, saved, rows, cell: (text: string) => editor.locator('td, th').filter({ hasText: new RegExp(`^${text}$`) }) }
}

test('edit a table from its bar, with the mouse and the keyboard', async ({ page }) => {
  const { editor, saved, rows, cell } = await openTable(page, 'Tablas E2E')
  const bar = page.getByRole('toolbar', { name: 'Tabla' })
  await expect(bar).toBeHidden()

  // In the header row a row can't go above it: Markdown keeps the header first.
  await cell('Fruta').click()
  await expect(bar).toBeVisible()
  await expect(bar.getByRole('button', { name: 'Insertar fila encima' })).toBeDisabled()

  // A row below the cursor, which goes into it.
  await cell('Pera').click()
  await bar.getByRole('button', { name: 'Insertar fila debajo' }).click()
  await page.keyboard.type('Kiwi')
  await expect.poll(rows).toEqual([['Fruta', 'Precio'], ['Pera', '2'], ['Kiwi', ''], ['Uva', '3']])

  // The column, centered; its new cell already shows it.
  await bar.getByRole('button', { name: 'Centrar columna' }).click()
  await expect(bar.getByRole('button', { name: 'Centrar columna' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(saved).toMatch(/\| :-+: \| -+: \|/)

  // A column to the right, with a header to write.
  await bar.getByRole('button', { name: 'Insertar columna a la derecha' }).click()
  await page.keyboard.type('x')
  await expect.poll(rows).toEqual([['Fruta', 'Precio'], ['Pera', '2'], ['Kiwi', ''], ['Uva', '3']].map((r, i) => (i === 2 ? [r[0]!, 'x', r[1]!] : [r[0]!, '', r[1]!])))

  // From the keyboard: Alt+F10 goes to the bar, the arrows move along it, Escape goes back.
  await page.keyboard.press('Alt+F10')
  await expect(bar.getByRole('button', { name: 'Insertar fila encima' })).toBeFocused()
  await page.keyboard.press('End')
  await expect(bar.getByRole('button', { name: 'Más opciones de la tabla' })).toBeFocused()
  await page.keyboard.press('Enter')
  await page.getByRole('menuitem', { name: 'Eliminar columna' }).click()
  await expect.poll(rows).toEqual([['Fruta', 'Precio'], ['Pera', '2'], ['Kiwi', ''], ['Uva', '3']])
  await expect(editor).toBeFocused()
  await page.keyboard.press('Alt+F10')
  await page.keyboard.press('Escape')
  await expect(editor).toBeFocused()

  // Its menu closed without choosing: from the keyboard, back to its button; with the mouse, back to the text.
  const more = bar.getByRole('button', { name: 'Más opciones de la tabla' })
  await page.keyboard.press('Alt+F10')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'Eliminar tabla' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(more).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(editor).toBeFocused()
  await more.click()
  await expect(page.getByRole('menuitem', { name: 'Eliminar tabla' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(editor).toBeFocused()
  await expect(bar).toBeVisible()

  // Each change is one step back.
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(rows).toEqual([['Fruta', '', 'Precio'], ['Pera', '', '2'], ['Kiwi', 'x', ''], ['Uva', '', '3']])
  await page.keyboard.press('ControlOrMeta+Shift+z')

  // Moving and deleting from the menu of the bar.
  await cell('Kiwi').click()
  await bar.getByRole('button', { name: 'Más opciones de la tabla' }).click()
  await page.getByRole('menuitem', { name: 'Bajar fila' }).click()
  await expect.poll(rows).toEqual([['Fruta', 'Precio'], ['Pera', '2'], ['Uva', '3'], ['Kiwi', '']])
  await bar.getByRole('button', { name: 'Más opciones de la tabla' }).click()
  await page.getByRole('menuitem', { name: 'Eliminar fila' }).click()
  await expect.poll(rows).toEqual([['Fruta', 'Precio'], ['Pera', '2'], ['Uva', '3']])

  // Selected text has the format menu, not both.
  await cell('Pera').dblclick()
  await expect(page.getByRole('button', { name: 'Negrita' })).toBeVisible()
  await expect(bar).toBeHidden()

  // Leaving the table, the bar goes; the rest of the page is as it was.
  await editor.getByText('Después').click()
  await expect(bar).toBeHidden()
  expect(await saved()).toMatch(/^Antes\n+\| Fruta \| Precio \|\n\| :-+: \| -+: \|\n\| Pera +\| 2 +\|\n\| Uva +\| 3 +\|\n+Después$/)
})

test('edit a table from the handles of its rows and columns and its «+»', async ({ page }) => {
  const { editor, rows, cell } = await openTable(page, 'Tablas asas E2E')
  const rowHandle = page.getByRole('button', { name: 'Opciones de la fila' })
  const columnHandle = page.getByRole('button', { name: 'Opciones de la columna' })

  // The handles come with the pointer, on its row and column.
  await expect(rowHandle).toBeHidden()
  await cell('Uva').hover()
  await expect(rowHandle).toBeVisible()
  await expect(columnHandle).toBeVisible()
  const uva = (await cell('Uva').boundingBox())!
  const handle = (await rowHandle.boundingBox())!
  expect(Math.abs(handle.y + handle.height / 2 - (uva.y + uva.height / 2))).toBeLessThan(2)

  // The row's menu: what it acts on is selected while it is open.
  await rowHandle.click()
  await expect(page.locator('.orq-prose .selectedCell')).toHaveCount(2)
  await page.screenshot({ path: test.info().outputPath('row-menu.png') })
  await page.getByRole('menuitem', { name: 'Subir fila' }).click()
  await expect.poll(rows).toEqual([['Fruta', 'Precio'], ['Uva', '3'], ['Pera', '2']])

  // The column's menu.
  await cell('Precio').hover()
  await columnHandle.click()
  await page.getByRole('menuitem', { name: 'Mover columna a la izquierda' }).click()
  await expect.poll(rows).toEqual([['Precio', 'Fruta'], ['3', 'Uva'], ['2', 'Pera']])

  // A menu closed without choosing gives the cursor back where it was.
  await cell('Uva').click()
  await page.keyboard.press('End')
  await cell('Pera').hover()
  await rowHandle.click()
  await page.keyboard.press('Escape')
  await expect(editor).toBeFocused()
  await expect(page.locator('.orq-prose .selectedCell')).toHaveCount(0)
  await page.keyboard.type('s')
  await expect.poll(rows).toEqual([['Precio', 'Fruta'], ['3', 'Uvas'], ['2', 'Pera']])

  // «+» adds a row at the end, or a column.
  await cell('Pera').hover()
  await page.getByRole('button', { name: 'Añadir una fila' }).click()
  await page.keyboard.type('4')
  await cell('Pera').hover()
  await page.getByRole('button', { name: 'Añadir una columna' }).click()
  await page.keyboard.type('Origen')
  await expect.poll(rows).toEqual([['Precio', 'Fruta', 'Origen'], ['3', 'Uvas', ''], ['2', 'Pera', ''], ['4', '', '']])
  await page.screenshot({ path: test.info().outputPath('table.png') })
})

// The empty line the editor keeps after a table at the end came with the first click, and in
// Firefox drawing it put the cursor back at the start of the page.
test('one click in a page that ends in a table puts the cursor where it lands', async ({ page }) => {
  const { saved, cell } = await openTable(page, 'Tablas al final E2E', `Antes\n\n${TABLE}`)
  await cell('Pera').click()
  await page.keyboard.type('X')
  await expect.poll(saved).toMatch(/^Antes\n\n\| Fruta \| Precio \|\n.+\n\| PeraX \| 2 +\|\n\| Uva +\| 3 +\|\n*$/)
})

test('in a card, Escape on the bar goes back to the text and leaves the card open', async ({ page }) => {
  const workspaceId = await openNewWorkspace(page, 'Tablas tarjeta E2E')
  const boardId = await createProject(page, 'Notas')
  const columns = ((await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string }> }).columns
  const card = (await (await page.request.post(`/api/columns/${columns[0]!.id}/cards`, { data: { title: 'Precios', description: TABLE } })).json()) as { id: string }
  await page.goto(`/w/${workspaceId}/b/${boardId}?card=${card.id}`)
  const description = page.getByRole('textbox', { name: 'Descripción de la tarjeta' })
  await description.locator('td').filter({ hasText: /^Pera$/ }).click()
  const bar = page.getByRole('toolbar', { name: 'Tabla' })
  await expect(bar.getByRole('button', { name: 'Insertar fila encima' })).toBeEnabled()
  await expect(bar).toBeVisible()
  await page.keyboard.press('Alt+F10')
  await expect(bar.getByRole('button', { name: 'Insertar fila encima' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(description).toBeFocused()
  await expect(page.getByLabel('Título de la tarjeta')).toHaveValue('Precios')
})

test.describe('on a phone', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

  test('tapping a cell brings the bar, inside the screen', async ({ page }) => {
    const { rows, cell } = await openTable(page, 'Tablas móvil E2E')
    const bar = page.getByRole('toolbar', { name: 'Tabla' })
    await cell('Pera').tap()
    await expect(bar).toBeVisible()
    const box = (await bar.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    // No handles without a mouse.
    await expect(page.getByRole('button', { name: 'Opciones de la fila' })).toBeHidden()
    await bar.getByRole('button', { name: 'Insertar fila debajo' }).tap()
    await page.keyboard.type('Kiwi')
    await expect.poll(rows).toEqual([['Fruta', 'Precio'], ['Pera', '2'], ['Kiwi', ''], ['Uva', '3']])
    await page.screenshot({ path: test.info().outputPath('phone.png') })
  })
})
