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
  const saved = async () => ((await (await page.request.get(`/api/pages/${pageId}`)).json()) as { content: string }).content.trim()
  return { editor, saved }
}

const DETAILS = '<details>\n<summary>Más detalles</summary>\n\nOculto\n\n</details>\n\nFin'

test('a <details> is a toggle: its arrow shows what it holds, and its title is edited as text', async ({ page }) => {
  const { editor, saved } = await openPage(page, 'Desplegables E2E', DETAILS)
  const hidden = editor.getByText('Oculto', { exact: true })
  await expect(editor.getByText('Más detalles', { exact: true })).toBeVisible()
  await expect(hidden).toBeHidden()

  // Its arrow: shown, hidden again; nothing is saved for it.
  await editor.getByRole('button', { name: 'Mostrar el contenido' }).click()
  await expect(hidden).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Ocultar el contenido' })).toHaveAttribute('aria-expanded', 'true')
  await editor.getByRole('button', { name: 'Ocultar el contenido' }).click()
  await expect(hidden).toBeHidden()
  expect(await saved()).toBe(DETAILS)

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

test.describe('on a phone', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

  test('its arrow opens it with a tap', async ({ page }) => {
    const { editor } = await openPage(page, 'Desplegables móvil E2E', DETAILS)
    await editor.getByRole('button', { name: 'Mostrar el contenido' }).tap()
    await expect(editor.getByText('Oculto', { exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('phone.png') })
  })
})
