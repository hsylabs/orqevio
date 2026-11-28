import type { Page } from '@playwright/test'
import { createProject, expect, openNewWorkspace, test } from './helpers'

// HTML's <details> as a toggle, as in Notion: an arrow shows or hides what is under its title. What
// it saves is still the <details> GitHub shows, as it was written.
async function openPage(page: Page, name: string, content: string) {
  const workspace = (await (await page.request.post('/api/workspaces', { data: { name } })).json()) as { id: string }
  const project = (await (await page.request.post(`/api/workspaces/${workspace.id}/projects`, { data: { name: 'Notas' } })).json()) as { id: string }
  const created = await page.request.post(`/api/projects/${project.id}/pages`, { data: { title: 'Desplegables', content } })
  expect(created.status(), await created.text()).toBe(201)
  const pageId = ((await created.json()) as { id: string }).id
  await page.goto(`/w/${workspace.id}/d/${pageId}`)
  const editor = page.getByRole('textbox', { name: 'Contenido de la página' })
  await expect(editor).toBeVisible()
  const read = async () => (await (await page.request.get(`/api/pages/${pageId}`)).json()) as { content: string; version: number }
  const saved = async () => (await read()).content.trim()
  const version = async () => (await read()).version
  return { editor, saved, version }
}

const DETAILS = '<details>\n<summary>Más detalles</summary>\n\nOculto\n\n</details>\n\nFin'

test('a <details> is a toggle: its arrow shows what it holds, and its title is edited as text', async ({ page }) => {
  const { editor, saved, version } = await openPage(page, 'Desplegables E2E', DETAILS)
  const first = await version()
  const hidden = editor.getByText('Oculto', { exact: true })
  await expect(editor.getByText('Más detalles', { exact: true })).toBeVisible()
  await expect(hidden).toBeHidden()

  // Its arrow: shown, hidden again; nothing is saved for it.
  await editor.getByRole('button', { name: 'Mostrar el contenido' }).click()
  await expect(hidden).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Ocultar el contenido' })).toHaveAttribute('aria-expanded', 'true')
  await editor.getByRole('button', { name: 'Ocultar el contenido' }).click()
  await expect(hidden).toBeHidden()
  // Longer than the editor waits before it saves: the page is still the version it was.
  await page.waitForTimeout(1500)
  expect(await version()).toBe(first)
  await expect(page.getByText('Cambios sin guardar')).toBeHidden()

  // Its title, edited as text: its summary is written anew.
  const title = editor.getByText('Más detalles', { exact: true })
  const box = (await title.boundingBox())!
  // Twice: Firefox puts the cursor of a first click at the start (card nUoMC5Z9).
  for (let i = 0; i < 2; i++) await title.click({ position: { x: box.width - 1, y: box.height / 2 } })
  await page.keyboard.type(' & más')
  await expect.poll(saved).toBe('<details>\n<summary>Más detalles &amp; más</summary>\n\nOculto\n\n</details>\n\nFin')

  // Ctrl+Enter in its title shows what it holds; Enter goes into it.
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(hidden).toBeVisible()
  await page.keyboard.press('Enter')
  await page.keyboard.type('Primero')
  await expect.poll(saved).toBe('<details>\n<summary>Más detalles &amp; más</summary>\n\nPrimero\n\nOculto\n\n</details>\n\nFin')
})

test('a toggle from the «/» menu: a title, and Enter into what it holds', async ({ page }) => {
  // An empty page: wherever the click lands, the cursor is in its only line (see card nUoMC5Z9).
  const { editor, saved } = await openPage(page, 'Desplegables barra E2E', '')
  await editor.click()
  await page.keyboard.type('/desplegable')
  await expect(page.getByRole('option', { name: /Desplegable/ })).toBeVisible()
  await page.keyboard.press('Enter')
  // Its empty title says what it is for.
  await expect(editor.locator('.orq-toggle-title.is-empty')).toHaveAttribute('data-placeholder', 'Título del desplegable')
  await page.keyboard.type('¿Cómo se instala?')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Con un comando.')
  await expect.poll(saved).toBe('<details>\n<summary>¿Cómo se instala?</summary>\n\nCon un comando.\n\n</details>')
  // Undone, the last line goes, and the toggle stays.
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(saved).toBe('<details>\n<summary>¿Cómo se instala?</summary>\n\n</details>')
})

test('in a comment, a toggle is the browser\'s own', async ({ page }) => {
  const workspaceId = await openNewWorkspace(page, 'Desplegables comentario E2E')
  const boardId = await createProject(page, 'Notas')
  const columns = ((await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string }> }).columns
  const card = (await (await page.request.post(`/api/columns/${columns[0]!.id}/cards`, { data: { title: 'Registro' } })).json()) as { id: string }
  await page.request.post(`/api/cards/${card.id}/comments`, { data: { body: '<details>\n<summary>Ver el registro</summary>\n\nLínea 1\n\n</details>' } })
  await page.goto(`/w/${workspaceId}/b/${boardId}?card=${card.id}`)
  const comment = page.locator('.orq-prose--note').filter({ hasText: 'Ver el registro' })
  await expect(comment.getByText('Línea 1')).toBeHidden()
  await comment.getByText('Ver el registro').click()
  await expect(comment.getByText('Línea 1')).toBeVisible()
})

test('a toggle heading from the «/» menu: its title a heading, as GitHub shows one in a <details>', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const { editor, saved } = await openPage(page, 'Títulos desplegables E2E', '')
  await editor.click()
  await page.keyboard.type('/desplegable 2')
  const option = page.getByRole('option', { name: /Título desplegable 2/ })
  await expect(option).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('slash-preview')).toContainText('Un título para una sección que muestra u oculta lo que hay debajo.')
  await page.screenshot({ path: testInfo.outputPath('toggle-heading-preview.png') })
  await page.keyboard.press('Enter')
  await page.keyboard.type('¿Cómo se instala?')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Con un comando.')
  await expect.poll(saved).toBe('<details>\n<summary><h2>¿Cómo se instala?</h2></summary>\n\nCon un comando.\n\n</details>')
  // Read as the heading it is, and as big as one, its arrow on its line.
  const title = editor.getByRole('heading', { level: 2, name: '¿Cómo se instala?' })
  await expect(title).toBeVisible()
  const size = await title.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))
  expect(size).toBeGreaterThan(20)
  expect(await title.evaluate((element) => getComputedStyle(element).fontWeight)).toBe('560')
  const arrow = (await editor.getByRole('button', { name: 'Ocultar el contenido' }).boundingBox())!
  const line = (await title.boundingBox())!
  expect(Math.abs(arrow.y + arrow.height / 2 - (line.y + size * 1.22 / 2))).toBeLessThan(3)
  await page.screenshot({ path: testInfo.outputPath('toggle-heading.png') })

  // «Turn into» another level, a toggle of text, and back.
  await page.keyboard.press('ControlOrMeta+/')
  await page.getByRole('menuitem', { name: 'Convertir en' }).press('ArrowRight')
  await expect(page.getByRole('menuitem', { name: /Título desplegable 2/ })).toBeDisabled()
  await page.getByRole('menuitem', { name: /Título desplegable 1/ }).click()
  await expect.poll(saved).toBe('<details>\n<summary><h1>¿Cómo se instala?</h1></summary>\n\nCon un comando.\n\n</details>')
  await expect(editor.getByRole('heading', { level: 1, name: '¿Cómo se instala?' })).toBeVisible()
})

test('a toggle heading written elsewhere, and in a comment the browser\'s own with its heading', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const content = '<details>\n<summary><h1>Guía</h1></summary>\n\nUno\n\n</details>\n\n<details>\n<summary><h3>Preguntas</h3></summary>\n\nDos\n\n</details>\n\nFin'
  const { editor, saved } = await openPage(page, 'Títulos desplegables escritos E2E', content)
  await expect(editor.getByRole('heading', { level: 1, name: 'Guía' })).toBeVisible()
  await expect(editor.getByRole('heading', { level: 3, name: 'Preguntas' })).toBeVisible()
  await expect(editor.getByText('Dos', { exact: true })).toBeHidden()
  await editor.getByRole('button', { name: 'Mostrar el contenido' }).nth(1).click()
  await expect(editor.getByText('Dos', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('toggle-headings-written.png') })
  expect(await saved()).toBe(content)

  const workspaceId = await openNewWorkspace(page, 'Títulos desplegables comentario E2E')
  const boardId = await createProject(page, 'Notas')
  const columns = ((await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string }> }).columns
  const card = (await (await page.request.post(`/api/columns/${columns[0]!.id}/cards`, { data: { title: 'Registro' } })).json()) as { id: string }
  await page.request.post(`/api/cards/${card.id}/comments`, { data: { body: '<details>\n<summary><h2>Ver el registro</h2></summary>\n\nLínea 1\n\n</details>' } })
  await page.goto(`/w/${workspaceId}/b/${boardId}?card=${card.id}`)
  const comment = page.locator('.orq-prose--note').filter({ hasText: 'Ver el registro' })
  const heading = comment.getByRole('heading', { level: 2, name: 'Ver el registro' })
  await expect(heading).toBeVisible()
  // As the same heading is in the editor.
  expect(await heading.evaluate((element) => getComputedStyle(element).fontWeight)).toBe('560')
  await expect(comment.getByText('Línea 1')).toBeHidden()
  await heading.click()
  await expect(comment.getByText('Línea 1')).toBeVisible()
  await comment.screenshot({ path: testInfo.outputPath('toggle-heading-comment.png') })
})

test.describe('on a phone', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

  test('its arrow opens it with a tap', async ({ page }) => {
    const { editor } = await openPage(page, 'Desplegables móvil E2E', DETAILS)
    await editor.getByRole('button', { name: 'Mostrar el contenido' }).tap()
    await expect(editor.getByText('Oculto', { exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('phone.png') })
  })
})
