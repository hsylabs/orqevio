import type { Page } from '@playwright/test'
import { createProject, expect, openNewWorkspace, test } from './helpers'

// The «/» menu's «Date» writes a day as text, as the app's language writes it in full: today with
// Enter, tomorrow, yesterday, or any day of a calendar. The Markdown keeps it as it is.

async function openPage(page: Page, name: string, content: string) {
  const workspace = (await (await page.request.post('/api/workspaces', { data: { name } })).json()) as { id: string }
  const project = (await (await page.request.post(`/api/workspaces/${workspace.id}/projects`, { data: { name: 'Notas' } })).json()) as { id: string }
  const created = await page.request.post(`/api/projects/${project.id}/pages`, { data: { title: 'Fechas', content } })
  expect(created.status(), await created.text()).toBe(201)
  const pageId = ((await created.json()) as { id: string }).id
  // A Thursday, whatever day the tests run on.
  await page.clock.setFixedTime(new Date(2026, 2, 5, 10, 0))
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

/** On a new line after `line`, the «/» menu's «Date». */
async function chooseDate(page: Page, editor: ReturnType<Page['getByRole']>, line: string) {
  await editor.getByText(line, { exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/fecha')
  await expect(page.getByRole('option', { name: /Fecha/ })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Insertar una fecha' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('a date from the «/» menu: today with Enter, as the language writes it, and the text goes on after it', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const { editor, saved } = await openPage(page, 'Fecha E2E', 'Uno')
  await editor.getByText('Uno', { exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/fecha')
  await expect(page.getByRole('option', { name: /Fecha/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('slash-preview')).toContainText('hoy, mañana, ayer o el día que elijas')
  await snap(page, testInfo.outputPath('date-slash.png'))
  await page.keyboard.press('Enter')

  const dialog = page.getByRole('dialog', { name: 'Insertar una fecha' })
  await expect(dialog.getByRole('button', { name: 'Hoy', exact: true })).toBeFocused()
  // Its calendar, said in the app's language too.
  await expect(dialog.getByRole('button', { name: 'Ir al mes siguiente' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Hoy', exact: true })).toHaveAttribute('title', '5 de marzo de 2026')
  await snap(page, testInfo.outputPath('date-dialog.png'))
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await page.keyboard.type(' por la tarde')
  await expect.poll(saved).toBe('Uno\n\n5 de marzo de 2026 por la tarde')
  await snap(page, testInfo.outputPath('date-inserted.png'))
})

test('tomorrow, yesterday or a day of the calendar; Esc leaves the text as it was', async ({ page }) => {
  const { editor, saved } = await openPage(page, 'Fecha días E2E', 'Uno')

  let dialog = await chooseDate(page, editor, 'Uno')
  await dialog.getByRole('button', { name: 'Mañana', exact: true }).click()
  await expect.poll(saved).toBe('Uno\n\n6 de marzo de 2026')

  dialog = await chooseDate(page, editor, '6 de marzo de 2026')
  await dialog.getByRole('button', { name: 'Ayer', exact: true }).click()
  await expect.poll(saved).toBe('Uno\n\n6 de marzo de 2026\n\n4 de marzo de 2026')

  // Any day of the calendar, today's month first.
  dialog = await chooseDate(page, editor, '4 de marzo de 2026')
  await dialog.locator('[data-day="2026-03-20"] button').click()
  await expect.poll(saved).toBe('Uno\n\n6 de marzo de 2026\n\n4 de marzo de 2026\n\n20 de marzo de 2026')

  // Closed without a day: no «/fecha» left, and the cursor where it was.
  dialog = await chooseDate(page, editor, '20 de marzo de 2026')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  // Back in the editor once the dialog has gone.
  await expect(editor).toBeFocused()
  await page.keyboard.type('Fin')
  await expect.poll(saved).toBe('Uno\n\n6 de marzo de 2026\n\n4 de marzo de 2026\n\n20 de marzo de 2026\n\nFin')
})

test('in a comment, Ctrl+Enter in the dialog sends nothing: the date goes in the box, and then it is sent', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 2, 5, 10, 0))
  const workspaceId = await openNewWorkspace(page, 'Fecha comentario E2E')
  const boardId = await createProject(page, 'Notas')
  const columns = ((await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string }> }).columns
  const card = (await (await page.request.post(`/api/columns/${columns[0]!.id}/cards`, { data: { title: 'Entrega' } })).json()) as { id: string }
  await page.goto(`/w/${workspaceId}/b/${boardId}?card=${card.id}`)
  const box = page.getByRole('textbox', { name: 'Nuevo comentario' })
  await box.click()
  await page.keyboard.type('Entrega el /fecha')
  await expect(page.getByRole('option', { name: /Fecha/ })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Insertar una fecha' })
  await expect(dialog.getByRole('button', { name: 'Hoy', exact: true })).toBeFocused()
  await page.keyboard.press('ControlOrMeta+Enter')
  await page.waitForTimeout(300)
  const bodies = async () => ((await (await page.request.get(`/api/cards/${card.id}/comments`)).json()) as { comments: Array<{ body: string }> }).comments.map((comment) => comment.body)
  expect(await bodies()).toEqual([])
  // Firefox takes it as Enter on «Today», which writes it; elsewhere the dialog waits for a day.
  if (await dialog.isVisible()) await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(box).toContainText('Entrega el 5 de marzo de 2026')
  await expect(box).toBeFocused()
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect.poll(bodies).toEqual(['Entrega el 5 de marzo de 2026'])
})
