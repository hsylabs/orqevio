import type { Page } from '@playwright/test'
import { createProject, expect, openNewWorkspace, test } from './helpers'

// The handle of each block, as in Notion: ⋮⋮ left of it, dragged to move it, clicked for its menu.
// What it does is still Markdown, block after block, as agents and GitHub read it.
async function openPage(page: Page, name: string, content: string) {
  const workspace = (await (await page.request.post('/api/workspaces', { data: { name } })).json()) as { id: string }
  const project = (await (await page.request.post(`/api/workspaces/${workspace.id}/projects`, { data: { name: 'Notas' } })).json()) as { id: string }
  const created = await page.request.post(`/api/projects/${project.id}/pages`, { data: { title: 'Bloques', content } })
  expect(created.status(), await created.text()).toBe(201)
  const pageId = ((await created.json()) as { id: string }).id
  await page.goto(`/w/${workspace.id}/d/${pageId}`)
  const editor = page.getByRole('textbox', { name: 'Contenido de la página' })
  await expect(editor).toBeVisible()
  const saved = async () => ((await (await page.request.get(`/api/pages/${pageId}`)).json()) as { content: string }).content.trim()
  return { editor, saved, text: (value: string) => editor.getByText(value, { exact: true }) }
}

test('move, duplicate, turn and delete blocks from their handle', async ({ page }) => {
  const { editor, saved, text } = await openPage(page, 'Bloques E2E', 'Uno\n\nDos\n\nTres')
  const handle = page.getByRole('button', { name: 'Opciones del bloque' })

  // The handle comes with the pointer, level with the block's line.
  await expect(handle).toBeHidden()
  await text('Dos').hover()
  await expect(handle).toBeVisible()
  const line = (await text('Dos').boundingBox())!
  const box = (await handle.boundingBox())!
  expect(Math.abs(box.y + box.height / 2 - (line.y + line.height / 2))).toBeLessThan(3)
  expect(box.x + box.width).toBeLessThanOrEqual(line.x)

  // Its menu: the block is selected while it is open.
  await handle.click()
  await expect(page.locator('.orq-prose .ProseMirror-selectednode')).toHaveText('Dos')
  await page.screenshot({ path: test.info().outputPath('menu.png') })
  await page.getByRole('menuitem', { name: 'Bajar' }).click()
  await expect.poll(saved).toBe('Uno\n\nTres\n\nDos')
  await expect(editor).toBeFocused()

  // «Convertir en», as the «/» menu.
  await text('Tres').hover()
  await handle.click()
  await page.getByRole('menuitem', { name: 'Convertir en' }).click()
  await expect(page.getByRole('menuitem', { name: 'Texto' })).toBeDisabled()
  await page.getByRole('menuitem', { name: 'Título 2' }).click()
  await expect.poll(saved).toBe('Uno\n\n## Tres\n\nDos')

  // Duplicate, then delete the copy.
  await text('Uno').hover()
  await handle.click()
  await page.getByRole('menuitem', { name: 'Duplicar' }).click()
  await expect.poll(saved).toBe('Uno\n\nUno\n\n## Tres\n\nDos')
  await editor.getByText('Uno', { exact: true }).nth(1).hover()
  await handle.click()
  await page.getByRole('menuitem', { name: 'Eliminar' }).click()
  await expect.poll(saved).toBe('Uno\n\n## Tres\n\nDos')

  // Each action is undone on its own.
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(saved).toBe('Uno\n\nUno\n\n## Tres\n\nDos')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(saved).toBe('Uno\n\n## Tres\n\nDos')
})

test('move list items from the keyboard, and open the menu with Ctrl+/', async ({ page }) => {
  const { editor, saved, text } = await openPage(page, 'Bloques teclado E2E', '- uno\n- dos\n- tres\n\nDespués')

  // Ctrl+Shift+↑/↓ moves the item with the cursor, within its list.
  await text('tres').click()
  await page.keyboard.press('ControlOrMeta+Shift+ArrowUp')
  await expect.poll(saved).toBe('- uno\n- tres\n- dos\n\nDespués')
  await page.keyboard.type('!')
  await expect.poll(saved).toBe('- uno\n- tres!\n- dos\n\nDespués')
  await page.keyboard.press('ControlOrMeta+Shift+ArrowUp')
  await page.keyboard.press('ControlOrMeta+Shift+ArrowUp')
  await expect.poll(saved).toBe('- tres!\n- uno\n- dos\n\nDespués')

  // Ctrl+/ opens the menu of the block with the cursor, on it; Escape closes it and the cursor is back.
  await page.keyboard.press('ControlOrMeta+/')
  await expect(page.getByRole('menuitem', { name: 'Duplicar' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Subir' })).toBeDisabled()
  await expect(page.getByRole('menuitem', { name: 'Bajar' })).toBeEnabled()
  await expect(page.locator('.orq-prose .ProseMirror-selectednode')).toHaveText('tres!')
  await page.keyboard.press('Escape')
  await expect(editor).toBeFocused()
  await page.keyboard.type(' y más')
  await expect.poll(saved).toBe('- tres! y más\n- uno\n- dos\n\nDespués')

  // From the keyboard, the menu's actions too.
  await page.keyboard.press('ControlOrMeta+/')
  await page.getByRole('menuitem', { name: 'Bajar' }).press('Enter')
  await expect.poll(saved).toBe('- uno\n- tres! y más\n- dos\n\nDespués')
})

test('each list item has its own handle, also over its bullet or its checkbox', async ({ page }) => {
  const { saved, text, editor } = await openPage(page, 'Bloques listas E2E', '- uno\n- dos\n- tres\n\n- [ ] hecho\n- [ ] pendiente\n\nFin\n\n- fuera\n  - dentro\n  - otro')
  const handle = page.getByRole('button', { name: 'Opciones del bloque' })
  // From the item's text to its handle, over its bullet: the handle stays the item's.
  await text('dos').hover()
  const item = (await text('dos').boundingBox())!
  await page.mouse.move(item.x - 10, item.y + item.height / 2, { steps: 5 })
  const box = (await handle.boundingBox())!
  expect(Math.abs(box.y + box.height / 2 - (item.y + item.height / 2))).toBeLessThan(3)
  await handle.click()
  await expect(page.locator('.orq-prose .ProseMirror-selectednode')).toHaveText('dos')
  await page.getByRole('menuitem', { name: 'Bajar' }).click()
  await expect.poll(saved).toBe('- uno\n- tres\n- dos\n\n- [ ] hecho\n- [ ] pendiente\n\nFin\n\n- fuera\n  - dentro\n  - otro')
  // Over a task's checkbox, that task.
  await editor.getByRole('checkbox', { name: 'Tarea: pendiente' }).hover()
  await handle.click()
  await page.getByRole('menuitem', { name: 'Subir' }).click()
  await expect.poll(saved).toBe('- uno\n- tres\n- dos\n\n- [ ] pendiente\n- [ ] hecho\n\nFin\n\n- fuera\n  - dentro\n  - otro')
  // An item of a list inside an item: from its text to its handle, the handle stays its own.
  await text('otro').hover()
  const inner = (await text('otro').boundingBox())!
  await page.mouse.move(inner.x - 30, inner.y + inner.height / 2, { steps: 8 })
  await handle.click()
  await expect(page.locator('.orq-prose .ProseMirror-selectednode')).toHaveText('otro')
  await page.getByRole('menuitem', { name: 'Subir' }).click()
  await expect.poll(saved).toBe('- uno\n- tres\n- dos\n\n- [ ] pendiente\n- [ ] hecho\n\nFin\n\n- fuera\n  - otro\n  - dentro')
})

test('drag a block by its handle to move it', async ({ page }) => {
  const { saved, text } = await openPage(page, 'Bloques arrastrar E2E', 'Uno\n\nDos\n\nTres')
  const handle = page.getByRole('button', { name: 'Opciones del bloque' })
  await text('Uno').hover()
  const target = (await text('Tres').boundingBox())!
  // Dropped at the end of «Tres», it goes after it, where the drop line shows.
  await handle.dragTo(text('Tres'), { targetPosition: { x: target.width - 4, y: target.height / 2 } })
  await expect.poll(saved).toBe('Dos\n\nTres\n\nUno')
})

test('in a card: handles in its description, none in its comments', async ({ page }) => {
  const workspaceId = await openNewWorkspace(page, 'Bloques tarjeta E2E')
  const boardId = await createProject(page, 'Notas')
  const columns = ((await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string }> }).columns
  const card = (await (await page.request.post(`/api/columns/${columns[0]!.id}/cards`, { data: { title: 'Pasos', description: 'Primero\n\nSegundo' } })).json()) as { id: string }
  await page.request.post(`/api/cards/${card.id}/comments`, { data: { body: 'Un comentario' } })
  await page.goto(`/w/${workspaceId}/b/${boardId}?card=${card.id}`)
  const description = page.getByRole('textbox', { name: 'Descripción de la tarjeta' })
  const handle = page.getByRole('button', { name: 'Opciones del bloque' })
  await description.getByText('Segundo').hover()
  await expect(handle).toBeVisible()
  await handle.click()
  await page.getByRole('menuitem', { name: 'Subir' }).click()
  await expect
    .poll(async () => ((await (await page.request.get(`/api/cards/${card.id}`)).json()) as { description: string }).description.trim())
    .toBe('Segundo\n\nPrimero')
  // The comment box is a short text: no handles.
  await page.getByRole('textbox', { name: 'Nuevo comentario' }).hover()
  await expect(handle).toBeHidden()
})

test.describe('on a phone', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

  test('the block with the cursor has its handle, inside the screen', async ({ page }) => {
    const { saved, text } = await openPage(page, 'Bloques móvil E2E', 'Uno\n\nDos')
    const handle = page.getByRole('button', { name: 'Opciones del bloque' })
    await text('Dos').tap()
    await expect(handle).toBeVisible()
    const box = (await handle.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    await handle.tap()
    await page.getByRole('menuitem', { name: 'Subir' }).tap()
    await expect.poll(saved).toBe('Dos\n\nUno')
    await page.screenshot({ path: test.info().outputPath('phone.png') })
  })
})
