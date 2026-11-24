import type { Page } from '@playwright/test'
import { createProject, expect, openNewWorkspace, test } from './helpers'

// GitHub's alerts as callouts, as in Notion: a box with its icon and its type, changed from a menu.
// What it saves is still the quote GitHub reads as an alert: `> [!NOTE]`.
async function openPage(page: Page, name: string, content: string) {
  const workspace = (await (await page.request.post('/api/workspaces', { data: { name } })).json()) as { id: string }
  const project = (await (await page.request.post(`/api/workspaces/${workspace.id}/projects`, { data: { name: 'Notas' } })).json()) as { id: string }
  const created = await page.request.post(`/api/projects/${project.id}/pages`, { data: { title: 'Avisos', content } })
  expect(created.status(), await created.text()).toBe(201)
  const pageId = ((await created.json()) as { id: string }).id
  await page.goto(`/w/${workspace.id}/d/${pageId}`)
  const editor = page.getByRole('textbox', { name: 'Contenido de la página' })
  await expect(editor).toBeVisible()
  const saved = async () => ((await (await page.request.get(`/api/pages/${pageId}`)).json()) as { content: string }).content.trim()
  return { editor, saved }
}

test('a GitHub alert is a callout whose type changes from its title', async ({ page }) => {
  const { editor, saved } = await openPage(page, 'Avisos E2E', 'Antes\n\n> [!NOTE]\n> Hola\n\n> [!tip] Título\n> Obsidian')
  // Its type by name, not its marker; an Obsidian callout stays the quote it is.
  const type = editor.getByRole('button', { name: 'Tipo de aviso: Nota' })
  await expect(type).toBeVisible()
  await expect(editor.locator('.orq-callout')).toHaveCount(1)
  await expect(editor.locator('.orq-callout')).not.toContainText('[!NOTE]')
  await expect(editor.locator('blockquote')).toContainText('[!tip] Título')
  await expect(type).toHaveAttribute('aria-expanded', 'false')

  // Its title's menu: the types, the current one ticked, and taking it away.
  await type.click()
  // With the menu open, the rest of the page is out of reach of screen readers (Radix): found by its class.
  await expect(page.locator('.orq-prose .orq-callout-type')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('menuitem', { name: 'Nota' })).toBeDisabled()
  await page.getByRole('menuitem', { name: 'Advertencia' }).click()
  await expect.poll(saved).toBe('Antes\n\n> [!WARNING]\n> Hola\n\n> [!tip] Título\n> Obsidian')
  await expect(editor.getByRole('button', { name: 'Tipo de aviso: Advertencia' })).toBeVisible()
  // The cursor wasn't in it: it goes to the end of its text, and the change is undone on its own.
  await expect(editor).toBeFocused()
  await page.keyboard.type('!')
  await expect.poll(saved).toBe('Antes\n\n> [!WARNING]\n> Hola!\n\n> [!tip] Título\n> Obsidian')
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(saved).toBe('Antes\n\n> [!NOTE]\n> Hola\n\n> [!tip] Título\n> Obsidian')

  // Taken away, what it held stays.
  await type.click()
  await page.getByRole('menuitem', { name: 'Quitar el aviso' }).click()
  await expect.poll(saved).toBe('Antes\n\nHola\n\n> [!tip] Título\n> Obsidian')
  await expect(editor.locator('.orq-callout')).toHaveCount(0)
})

test('a callout from the «/» menu, and its type from the block menu with the keyboard', async ({ page }) => {
  // An empty page: wherever the click lands, the cursor is in its only line (see card nUoMC5Z9).
  const { editor, saved } = await openPage(page, 'Avisos teclado E2E', '')
  await editor.click()
  await page.keyboard.type('/aviso')
  await expect(page.getByRole('option', { name: /Aviso/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await page.keyboard.type('Revisa esto')
  await expect.poll(saved).toBe('> [!NOTE]\n> Revisa esto')

  // Ctrl+/ → «Tipo de aviso» → «Importante», all from the keyboard.
  await page.keyboard.press('ControlOrMeta+/')
  await page.getByRole('menuitem', { name: 'Tipo de aviso' }).press('ArrowRight')
  await expect(page.getByRole('menuitem', { name: 'Nota' })).toBeDisabled()
  await page.getByRole('menuitem', { name: 'Importante' }).press('Enter')
  await expect.poll(saved).toBe('> [!IMPORTANT]\n> Revisa esto')
  await expect(editor).toBeFocused()

  // «Convertir en» → «Cita»: the quote it is in Markdown, without its marker.
  await page.keyboard.press('ControlOrMeta+/')
  await page.getByRole('menuitem', { name: 'Convertir en' }).press('ArrowRight')
  await page.getByRole('menuitem', { name: 'Cita' }).press('Enter')
  await expect.poll(saved).toBe('> Revisa esto')
})

test('a callout inside a quote has its types in the menu of the quote, from the keyboard', async ({ page }) => {
  const { editor, saved } = await openPage(page, 'Avisos anidados E2E', '> Fuera\n>\n> > [!TIP]\n> > Dentro')
  const text = editor.getByText('Dentro', { exact: true })
  const box = (await text.boundingBox())!
  // Twice: Firefox puts the cursor of a first click at the start (card nUoMC5Z9).
  for (let i = 0; i < 2; i++) await text.click({ position: { x: box.width - 1, y: box.height / 2 } })
  await page.keyboard.press('ControlOrMeta+/')
  await page.getByRole('menuitem', { name: 'Tipo de aviso' }).press('ArrowRight')
  await page.getByRole('menuitem', { name: 'Importante' }).press('Enter')
  await expect.poll(saved).toBe('> Fuera\n>\n> > [!IMPORTANT]\n> > Dentro')
})

test('in a comment, a callout shows its icon and its type', async ({ page }) => {
  const workspaceId = await openNewWorkspace(page, 'Avisos comentario E2E')
  const boardId = await createProject(page, 'Notas')
  const columns = ((await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string }> }).columns
  const card = (await (await page.request.post(`/api/columns/${columns[0]!.id}/cards`, { data: { title: 'Revisión' } })).json()) as { id: string }
  await page.request.post(`/api/cards/${card.id}/comments`, { data: { body: '> [!CAUTION]\n> No borres la rama.' } })
  await page.goto(`/w/${workspaceId}/b/${boardId}?card=${card.id}`)
  const comment = page.locator('.orq-prose--note').filter({ hasText: 'No borres la rama.' })
  await expect(comment.locator('.orq-callout--caution .orq-callout-type')).toHaveText('Precaución')
  await expect(comment).not.toContainText('[!CAUTION]')
})

test.describe('on a phone', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

  test('its type changes with a tap', async ({ page }) => {
    const { saved } = await openPage(page, 'Avisos móvil E2E', '> [!NOTE]\n> En el móvil')
    await page.getByRole('button', { name: 'Tipo de aviso: Nota' }).tap()
    await page.getByRole('menuitem', { name: 'Consejo' }).tap()
    await expect.poll(saved).toBe('> [!TIP]\n> En el móvil')
    await page.screenshot({ path: test.info().outputPath('phone.png') })
  })
})
