import type { Locator, Page } from '@playwright/test'
import { createProject, expect, openNewWorkspace, test } from './helpers'

// Inserting a block without knowing the «/»: a hint on the empty line with the cursor, a «+» beside
// each block's handle, and the Markdown shortcut of each block in the «/» menu.

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

/** What a line shows while empty: its placeholder, drawn before it, or nothing. */
const hint = (line: Locator) => line.evaluate((el) => getComputedStyle(el, '::before').content.replace(/^"|"$/g, ''))

test('the empty line with the cursor says how to insert a block, and no other', async ({ page }) => {
  const { editor } = await openPage(page, 'Pista E2E', 'Uno\n\nDos')
  const lines = editor.locator(':scope > p')
  await editor.getByText('Uno', { exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(lines).toHaveCount(3)
  expect(await hint(lines.nth(1))).toBe('Pulsa «/» para insertar…')

  // On another empty line, there and only there.
  await editor.getByText('Dos', { exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(lines).toHaveCount(4)
  await expect.poll(() => hint(lines.nth(3))).toBe('Pulsa «/» para insertar…')
  expect(await hint(lines.nth(1))).toBe('none')

  // Not while the editor doesn't have the focus.
  await page.getByLabel('Título de la página').click()
  await expect.poll(() => hint(lines.nth(3))).toBe('none')
})

test('an empty page keeps its own hint, and a comment says the «/» too', async ({ page }) => {
  const { editor } = await openPage(page, 'Pista vacía E2E', '')
  expect(await hint(editor.locator('p').first())).toBe('Escribe, o pulsa «/» para insertar…')

  const workspaceId = await openNewWorkspace(page, 'Pista comentario E2E')
  const boardId = await createProject(page, 'Notas')
  const columns = ((await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string }> }).columns
  const card = (await (await page.request.post(`/api/columns/${columns[0]!.id}/cards`, { data: { title: 'Mudanza' } })).json()) as { id: string }
  await page.goto(`/w/${workspaceId}/b/${boardId}?card=${card.id}`)
  const box = page.getByRole('textbox', { name: 'Nuevo comentario' })
  expect(await hint(box.locator('p').first())).toBe('Escribe un comentario, o pulsa «/» para insertar… Admite Markdown.')
})

test('the «+» beside a block opens the «/» menu on a line below it', async ({ page }) => {
  const { editor, saved } = await openPage(page, 'Más E2E', 'Uno\n\nDos')
  const plus = page.getByRole('button', { name: 'Insertar debajo' })
  const menu = page.getByRole('listbox', { name: 'Insertar bloque' })

  // Closed without a choice, the page is as it was.
  await editor.getByText('Uno', { exact: true }).hover()
  await plus.click()
  await expect(menu).toBeVisible()
  await expect(editor.locator(':scope > p')).toHaveCount(3)
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(editor.locator(':scope > p')).toHaveCount(2)
  await expect(editor).toHaveText('UnoDos')

  // A heading below the block, which one undo takes away.
  await editor.getByText('Uno', { exact: true }).hover()
  await plus.click()
  await menu.getByRole('option', { name: /Título 2/ }).click()
  await expect(editor.locator(':scope > h2')).toHaveCount(1)
  await expect(editor.locator(':scope > *').nth(1)).toHaveJSProperty('tagName', 'H2')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(editor.locator(':scope > h2')).toHaveCount(0)
  await expect(editor.locator(':scope > p')).toHaveCount(2)
  await expect(editor).toHaveText('UnoDos')

  // Its search works as the «/» does.
  await editor.getByText('Uno', { exact: true }).hover()
  await plus.click()
  await page.keyboard.type('lista n')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Cajas')
  await expect.poll(saved).toBe('Uno\n\n1. Cajas\n\nDos')

  // Below an item, the next item, as Enter at its end would make it; its own kind of list keeps it one.
  await editor.getByText('Cajas').hover()
  await plus.click()
  await expect(editor.locator('ol > li')).toHaveCount(2)
  await expect(editor.locator('ol > li').nth(1)).toHaveText('/')
  await page.keyboard.press('Escape')
  await expect(editor.locator('ol > li')).toHaveCount(1)
  await editor.getByText('Cajas').hover()
  await plus.click()
  // The list chosen before comes first too, among the «Sugerencias»: either is the same.
  await menu.getByRole('option', { name: /Lista numerada/ }).first().click()
  await page.keyboard.type('Cinta')
  await expect.poll(saved).toBe('Uno\n\n1. Cajas\n2. Cinta\n\nDos')
})

test('only one line of the «+» is open, and what was typed in it is not left saved', async ({ page }) => {
  const { editor, saved } = await openPage(page, 'Más una línea E2E', 'Uno\n\nDos')
  const plus = page.getByRole('button', { name: 'Insertar debajo' })
  const menu = page.getByRole('listbox', { name: 'Insertar bloque' })
  const slashes = editor.locator(':scope > p').filter({ hasText: /^\// })

  // A second «+» closes the first line.
  await editor.getByText('Uno', { exact: true }).hover()
  await plus.click()
  await editor.getByText('Dos', { exact: true }).hover()
  await plus.click()
  await expect(slashes).toHaveCount(1)
  await expect(editor.locator(':scope > *').nth(2)).toHaveText('/')
  await page.keyboard.press('Escape')
  await expect(slashes).toHaveCount(0)

  // Typed in and taken back, saved on the way: closing it saves the page without it.
  await editor.getByText('Uno', { exact: true }).hover()
  await plus.click()
  await page.keyboard.type('xyz')
  await expect.poll(saved).toBe('Uno\n\n/xyz\n\nDos')
  for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(slashes).toHaveCount(0)
  await expect.poll(saved).toBe('Uno\n\nDos')

  // A block's handle, with a line open: the line goes and the menu is that block's.
  await editor.getByText('Uno', { exact: true }).hover()
  await plus.click()
  await editor.getByText('Dos', { exact: true }).hover()
  await page.getByRole('button', { name: 'Opciones del bloque' }).click()
  await page.getByRole('menuitem', { name: 'Duplicar' }).click()
  await expect(slashes).toHaveCount(0)
  await expect.poll(saved).toBe('Uno\n\nDos\n\nDos')
})

test('from the keyboard, «Insertar debajo» in the block menu does the same', async ({ page }) => {
  const { editor, saved } = await openPage(page, 'Más teclado E2E', 'Uno\n\nDos')
  await editor.getByText('Dos', { exact: true }).click()
  await page.keyboard.press('ControlOrMeta+/')
  await page.getByRole('menuitem', { name: 'Insertar debajo' }).press('Enter')
  const menu = page.getByRole('listbox', { name: 'Insertar bloque' })
  await expect(menu).toBeVisible()
  // The block menu closing gives the focus back to the editor, where the search is typed.
  await expect(editor).toBeFocused()
  await page.keyboard.type('separador')
  await page.keyboard.press('Enter')
  await expect(editor.locator('hr')).toHaveCount(1)
  await expect.poll(saved).toMatch(/^Uno\n\nDos\n\n---\n*$/)
})

test('the «/» menu and «Convertir en» show each block’s Markdown shortcut', async ({ page }) => {
  const { editor } = await openPage(page, 'Atajos E2E', 'Uno')
  await editor.getByText('Uno', { exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  const menu = page.getByRole('listbox', { name: 'Insertar bloque' })
  const shortcut = (name: RegExp) => menu.getByRole('option', { name }).locator('kbd')
  await expect(shortcut(/Título 1 Encabezado/)).toHaveText('#')
  await expect(shortcut(/Título 3 Subsección/)).toHaveText('###')
  await expect(shortcut(/Lista con viñetas/)).toHaveText('-')
  await expect(shortcut(/Lista numerada/)).toHaveText('1.')
  await expect(shortcut(/Lista de tareas/)).toHaveText('[]')
  await expect(shortcut(/Bloque de código/)).toHaveText('```')
  // Read out too, as what it is.
  await expect(menu.getByRole('option', { name: /Título 1 Encabezado/ })).toHaveAccessibleName(/Atajo de Markdown: #$/)
  // What has none, none.
  await expect(shortcut(/Texto Párrafo normal/)).toHaveCount(0)
  await expect(shortcut(/Tabla/)).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('slash-shortcuts.png') })
  await page.keyboard.press('Escape')

  await editor.getByText('Uno', { exact: true }).click()
  await page.keyboard.press('ControlOrMeta+/')
  await page.getByRole('menuitem', { name: 'Convertir en' }).press('ArrowRight')
  await expect(page.getByRole('menuitem', { name: /Título 2/ })).toContainText('##')
})

test.describe('on a phone', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

  test('a tap on the «+» of the block with the cursor opens the «/» menu below it', async ({ page }) => {
    const { editor, saved } = await openPage(page, 'Más móvil E2E', 'Uno\n\nDos')
    await editor.getByText('Uno', { exact: true }).tap()
    const plus = page.getByRole('button', { name: 'Insertar debajo' })
    await expect(plus).toBeVisible()
    const box = (await plus.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    await plus.tap()
    await page.getByRole('listbox', { name: 'Insertar bloque' }).getByRole('option', { name: /Lista de tareas/ }).tap()
    await page.keyboard.type('Cajas')
    await expect.poll(saved).toBe('Uno\n\n- [ ] Cajas\n\nDos')
    await page.screenshot({ path: test.info().outputPath('phone-plus.png') })
  })
})
