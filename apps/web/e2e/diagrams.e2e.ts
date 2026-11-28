import type { Page } from '@playwright/test'
import { createProject, expect, openNewWorkspace, test } from './helpers'

// Diagrams in Mermaid, as GitHub draws them: a code block whose language is `mermaid`. The code is
// what is saved; its drawing shows in its place, and the code with it while the cursor is in it.

async function openPage(page: Page, name: string, content: string) {
  const workspace = (await (await page.request.post('/api/workspaces', { data: { name } })).json()) as { id: string }
  const project = (await (await page.request.post(`/api/workspaces/${workspace.id}/projects`, { data: { name: 'Notas' } })).json()) as { id: string }
  const created = await page.request.post(`/api/projects/${project.id}/pages`, { data: { title: 'Diagramas', content } })
  expect(created.status(), await created.text()).toBe(201)
  const pageId = ((await created.json()) as { id: string }).id
  await page.goto(`/w/${workspace.id}/d/${pageId}`)
  const editor = page.getByRole('textbox', { name: 'Contenido de la página' })
  await expect(editor).toBeVisible()
  const saved = async () => ((await (await page.request.get(`/api/pages/${pageId}`)).json()) as { content: string }).content.trim()
  return { editor, saved }
}

/** Once what is shown has settled, as it is seen. */
async function snap(page: Page, path: string) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
  await page.screenshot({ path })
}

const FLOW = '```mermaid\nflowchart LR\n  Idea --> Plan\n```'

test('a diagram shows its drawing in place of its code, which shows with it while it is edited', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  // Nothing in it runs: no dialog may open.
  page.on('dialog', (dialog) => {
    throw new Error(`A dialog opened: ${dialog.message()}`)
  })
  const { editor, saved } = await openPage(page, 'Diagramas E2E', `Antes\n\n${FLOW}\n\nDespués`)
  const block = editor.locator('.orq-code[data-diagram]')
  const drawing = block.locator('.orq-diagram svg')
  await expect(drawing).toBeVisible()
  await expect(drawing).toContainText('Idea')
  await expect(drawing).toContainText('Plan')
  await expect(block.locator(':scope > pre')).toBeHidden()
  await expect(block.getByRole('button', { name: 'Diagrama', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await snap(page, testInfo.outputPath('diagram.png'))

  // Its code, and both.
  await block.getByRole('button', { name: 'Código', exact: true }).click()
  await expect(block.locator(':scope > pre')).toBeVisible()
  await expect(block.locator('.orq-diagram')).toBeHidden()
  await block.getByRole('button', { name: 'Ambos', exact: true }).click()
  await expect(block.locator(':scope > pre')).toBeVisible()
  await expect(drawing).toBeVisible()
  await block.getByRole('button', { name: 'Diagrama', exact: true }).click()
  await expect(block.locator(':scope > pre')).toBeHidden()

  // A press on the drawing puts the cursor at the end of its code, which shows; what is typed is drawn.
  await drawing.click()
  await expect(block.locator(':scope > pre')).toBeVisible()
  await page.keyboard.type(' --> Hecho')
  await expect(drawing).toContainText('Hecho')
  await snap(page, testInfo.outputPath('diagram-editing.png'))
  await expect.poll(saved).toBe('Antes\n\n```mermaid\nflowchart LR\n  Idea --> Plan --> Hecho\n```\n\nDespués')

  // Away from it, its drawing alone again.
  await editor.getByText('Después', { exact: true }).click()
  await expect(block.locator(':scope > pre')).toBeHidden()
})

test('a diagram from the «/» menu starts from one, and one that can\'t be drawn says why', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const { editor, saved } = await openPage(page, 'Diagramas barra E2E', 'Uno')
  await editor.getByText('Uno', { exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/mermaid')
  await expect(page.getByRole('option', { name: /Diagrama Mermaid/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('slash-preview')).toContainText('se guarda su código y se ve su dibujo')
  await snap(page, testInfo.outputPath('diagram-slash.png'))
  await page.keyboard.press('Enter')
  const block = editor.locator('.orq-code[data-diagram]')
  await expect(block.locator('.orq-diagram svg')).toContainText('C')
  await expect.poll(saved).toBe('Uno\n\n```mermaid\nflowchart LR\n  A --> B --> C\n```')

  // Written wrong: its code stays, and why it can't be drawn shows under it.
  await page.keyboard.type(' -->')
  await expect(block.locator('.orq-diagram')).toContainText('No se puede dibujar el diagrama:')
  await expect(block).toHaveAttribute('data-error', '')
  await snap(page, testInfo.outputPath('diagram-error.png'))
  // With the cursor elsewhere too: no drawing to show in its place.
  await editor.getByText('Uno', { exact: true }).click()
  await expect(block.locator(':scope > pre')).toBeVisible()
  await expect(block.locator('.orq-diagram')).toContainText('No se puede dibujar el diagrama:')
  // A press on its box puts the cursor back at the end of its code.
  await block.locator('.orq-diagram').click()
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await expect(block).not.toHaveAttribute('data-error', '')
  await expect(block.locator('.orq-diagram svg')).toBeVisible()
})

test('what a diagram holds runs nothing and stays in its box', async ({ page }) => {
  page.on('dialog', (dialog) => {
    throw new Error(`A dialog opened: ${dialog.message()}`)
  })
  const code = [
    '```mermaid',
    '%%{init: {"securityLevel": "loose", "themeCSS": "body { display: none }"}}%%',
    'flowchart LR',
    '  A["<img src=x onerror=alert(1)>Uno"] --> B["<b onmouseover=alert(2)>Dos</b>"]',
    '  click A "javascript:alert(3)"',
    '  click B callback',
    '```',
  ].join('\n')
  const { editor } = await openPage(page, 'Diagramas seguros E2E', code)
  const drawing = editor.locator('.orq-diagram svg')
  await expect(drawing).toBeVisible()
  await expect(drawing).toContainText('Uno')
  expect(await editor.locator('.orq-diagram [onerror], .orq-diagram [onmouseover], .orq-diagram [onclick], .orq-diagram a[href^="javascript"], .orq-diagram script').count()).toBe(0)
  // Its own CSS stays out of the page.
  await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible()
  await drawing.getByText('Uno').click({ force: true })
  await drawing.getByText('Dos').hover({ force: true })
})

test('a link in a drawing leads nowhere in the editor, and ↓ and a selection reach its hidden code', async ({ page }) => {
  const code = '```mermaid\nflowchart LR\n  Idea --> Plan\n  click Plan "https://example.com/login"\n```'
  const { editor, saved } = await openPage(page, 'Diagramas enlaces E2E', `Antes\n\n${code}\n\nDespués`)
  const block = editor.locator('.orq-code[data-diagram]')
  const drawing = block.locator('.orq-diagram svg')
  await expect(drawing).toContainText('Plan')
  const address = page.url()
  // A click on the link: no page left, and the cursor in its code.
  await drawing.locator('a').first().click()
  await expect(block.locator(':scope > pre')).toBeVisible()
  await page.waitForTimeout(300)
  expect(page.url()).toBe(address)

  // From the line above, ↓ goes into its code, hidden until then.
  await editor.getByText('Antes', { exact: true }).click()
  await expect(block.locator(':scope > pre')).toBeHidden()
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowDown')
  await expect(block.locator(':scope > pre')).toBeVisible()
  await page.keyboard.type('%% nota')
  await page.keyboard.press('Enter')
  await expect.poll(saved).toContain('```mermaid\n%% nota\nflowchart LR')
  await expect(drawing).toContainText('Plan')

  // A selection that starts in it and ends after it keeps it shown.
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowDown')
  await expect(block.locator(':scope > pre')).toBeVisible()
})

test('in a comment, a diagram is drawn in place of its code', async ({ page }, testInfo) => {
  const workspaceId = await openNewWorkspace(page, 'Diagramas comentario E2E')
  const boardId = await createProject(page, 'Notas')
  const columns = ((await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string }> }).columns
  const card = (await (await page.request.post(`/api/columns/${columns[0]!.id}/cards`, { data: { title: 'Flujo' } })).json()) as { id: string }
  await page.request.post(`/api/cards/${card.id}/comments`, { data: { body: `Así queda:\n\n${FLOW}` } })
  await page.goto(`/w/${workspaceId}/b/${boardId}?card=${card.id}`)
  const comment = page.locator('.orq-prose--note').filter({ hasText: 'Así queda:' })
  await expect(comment.locator('.orq-diagram svg')).toContainText('Plan')
  await expect(comment.locator('pre')).toBeHidden()
  await comment.screenshot({ path: testInfo.outputPath('diagram-comment.png') })
})
