import type { Page } from '@playwright/test'
import { createProject, expect, openNewWorkspace, test } from './helpers'

// Formulas in LaTeX, as in Notion, drawn by KaTeX: written in a field under them, with how they look
// as they are typed. What is saved is what GitHub reads: `$…$` in a line, `$$` around one of its own.
async function openPage(page: Page, name: string, content: string) {
  const workspace = (await (await page.request.post('/api/workspaces', { data: { name } })).json()) as { id: string }
  const project = (await (await page.request.post(`/api/workspaces/${workspace.id}/projects`, { data: { name: 'Notas' } })).json()) as { id: string }
  const created = await page.request.post(`/api/projects/${project.id}/pages`, { data: { title: 'Fórmulas', content } })
  expect(created.status(), await created.text()).toBe(201)
  const pageId = ((await created.json()) as { id: string }).id
  await page.goto(`/w/${workspace.id}/d/${pageId}`)
  const editor = page.getByRole('textbox', { name: 'Contenido de la página' })
  await expect(editor).toBeVisible()
  const saved = async () => ((await (await page.request.get(`/api/pages/${pageId}`)).json()) as { content: string }).content.trim()
  return { editor, saved }
}

test('a formula in a line is drawn, and changed in the field a click opens under it', async ({ page }) => {
  const { editor, saved } = await openPage(page, 'Fórmulas E2E', 'La energía $E = mc^2$ y $5 de precio')
  const formula = editor.locator('.orq-math')
  await expect(formula).toHaveCount(1)
  await expect(formula.locator('.katex')).toBeVisible()
  // The price stays text.
  await expect(editor).toContainText('y $5 de precio')

  // On what KaTeX drew: its MathML copy for screen readers is a dot in its corner, which Playwright aims at.
  const drawn = formula.locator('.katex-html')
  await drawn.click()
  const dialog = page.getByRole('dialog', { name: 'Editar fórmula' })
  const field = dialog.getByRole('textbox', { name: 'Fórmula en LaTeX' })
  await expect(field).toBeFocused()
  await expect(field).toHaveValue('E = mc^2')
  await field.fill('\\frac{a}{')
  // What is wrong with it, as it is typed; then how it looks.
  await expect(dialog.getByText(/Error en la fórmula/)).toBeVisible()
  await field.fill('\\frac{a}{b}')
  await expect(dialog.getByText(/Error en la fórmula/)).toHaveCount(0)
  await expect(dialog.locator('.orq-math-preview .katex')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect.poll(saved).toBe('La energía $\\frac{a}{b}$ y $5 de precio')

  // The cursor is right after it: typing goes on there, and doesn't replace it.
  await expect(editor).toBeFocused()
  await page.keyboard.type(' (sí)')
  await expect.poll(saved).toBe('La energía $\\frac{a}{b}$ (sí) y $5 de precio')
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(saved).toBe('La energía $E = mc^2$ y $5 de precio')

  // Escape leaves it as it was.
  await drawn.click()
  await field.fill('x')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(formula).toHaveAttribute('data-latex', 'E = mc^2')
})

test('a formula of its own from the «/» menu, opened again with Enter, and one in a line from the keyboard', async ({ page }) => {
  // An empty page: wherever the click lands, the cursor is in its only line (see card nUoMC5Z9).
  const { editor, saved } = await openPage(page, 'Fórmulas teclado E2E', '')
  await editor.click()
  await page.keyboard.type('/formula')
  await expect(page.getByRole('option').first()).toContainText('Una fórmula en su propio bloque')
  await page.keyboard.press('Enter')
  const field = page.getByRole('dialog', { name: 'Editar fórmula' }).getByRole('textbox', { name: 'Fórmula en LaTeX' })
  await expect(field).toBeFocused()
  await page.keyboard.type('\\sum_{i=1}^{n} i')
  // Shift+Enter, another line in one of its own.
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('= \\frac{n(n+1)}{2}')
  await page.keyboard.press('Enter')
  await expect.poll(saved).toBe('$$\n\\sum_{i=1}^{n} i\n= \\frac{n(n+1)}{2}\n$$')
  await expect(editor.locator('.orq-math--block .katex-display')).toBeVisible()

  // Selected, Enter opens it again; emptied, it goes.
  await expect(editor).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(field).toBeFocused()
  await field.fill('')
  await page.keyboard.press('Enter')
  await expect(editor.locator('.orq-math')).toHaveCount(0)

  // Text selected becomes a formula in a line with Ctrl+Shift+E; typing $$x$$ makes one too.
  await editor.click()
  await page.keyboard.type('Área a^2 aquí')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('ControlOrMeta+Shift+e')
  await expect(field).toBeFocused()
  await page.keyboard.press('Enter')
  await expect.poll(saved).toBe('Área $a^2$ aquí')
  await page.keyboard.press('End')
  await page.keyboard.type(' y $$b^2$$ fin')
  // Saved as one in a line is: GitHub reads it the same.
  await expect.poll(saved).toBe('Área $a^2$ aquí y $b^2$ fin')
  await expect(editor.locator('.orq-math')).toHaveCount(2)
})

test('in a comment, a formula is drawn as in the editor', async ({ page }) => {
  const workspaceId = await openNewWorkspace(page, 'Fórmulas comentario E2E')
  const boardId = await createProject(page, 'Notas')
  const columns = ((await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string }> }).columns
  const card = (await (await page.request.post(`/api/columns/${columns[0]!.id}/cards`, { data: { title: 'Revisión' } })).json()) as { id: string }
  await page.request.post(`/api/cards/${card.id}/comments`, { data: { body: 'Queda $x^2$ y\n\n$$\n\\sqrt{2}\n$$' } })
  await page.goto(`/w/${workspaceId}/b/${boardId}?card=${card.id}`)
  const comment = page.locator('.orq-prose--note').filter({ hasText: 'Queda' })
  await expect(comment.locator('.orq-math .katex')).toHaveCount(2)
  await expect(comment.locator('.orq-math--block .katex-display')).toBeVisible()
})

test.describe('on a phone', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

  test('a formula opens with a tap and is changed there', async ({ page }) => {
    const { editor, saved } = await openPage(page, 'Fórmulas móvil E2E', 'Una $x$ aquí')
    await editor.locator('.orq-math .katex-html').tap()
    const dialog = page.getByRole('dialog', { name: 'Editar fórmula' })
    const field = dialog.getByRole('textbox', { name: 'Fórmula en LaTeX' })
    await expect(field).toBeVisible()
    // Within the screen.
    const box = (await dialog.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    await field.fill('x^{2}')
    await dialog.getByRole('button', { name: 'Hecho' }).tap()
    await expect.poll(saved).toBe('Una $x^{2}$ aquí')
    await page.screenshot({ path: test.info().outputPath('phone.png') })
  })
})
