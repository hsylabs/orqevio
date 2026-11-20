import type { APIRequestContext, Page } from '@playwright/test'
import { createProject, expect, openNewWorkspace, test } from './helpers'

type Board = { id: string; projectId: string; columns: Array<{ id: string; name: string }>; cards: Array<{ id: string; title: string; columnId: string }> }
const board = async (request: APIRequestContext, id: string) => (await (await request.get(`/api/boards/${id}`)).json()) as Board
const remove = async (request: APIRequestContext, url: string) => expect((await request.delete(url)).status()).toBe(200)

/** A trash with, newest first: a page, a board with a card, and two cards called "Uno" and "Dos". */
async function fill(page: Page) {
  const workspaceId = await openNewWorkspace(page, 'Selección E2E')
  const boardId = await createProject(page, 'Mudanza')
  const tasks = await board(page.request, boardId)
  const todo = tasks.columns.find((c) => c.name === 'Por hacer')!
  const make = async (title: string, column = todo.id) => ((await (await page.request.post(`/api/columns/${column}/cards`, { data: { title } })).json()) as { id: string }).id
  const uno = await make('Uno')
  const dos = await make('Dos')
  const archive = ((await (await page.request.post(`/api/projects/${tasks.projectId}/boards`, { data: { name: 'Archivo' } })).json()) as { id: string }).id
  await make('Caja vieja', (await board(page.request, archive)).columns[0]!.id)
  const notes = ((await (await page.request.post(`/api/projects/${tasks.projectId}/pages`, { data: { title: 'Notas' } })).json()) as { id: string }).id
  // Away from the board first, from the sidebar, as a person would.
  await page.getByRole('navigation').getByRole('link', { name: 'Papelera' }).click()
  await expect(page).toHaveURL(`/w/${workspaceId}/trash`)
  await remove(page.request, `/api/cards/${uno}`)
  await remove(page.request, `/api/cards/${dos}`)
  await remove(page.request, `/api/boards/${archive}`)
  await remove(page.request, `/api/pages/${notes}`)
  const list = page.getByRole('list', { name: 'Papelera' })
  await expect(list.getByRole('listitem')).toHaveCount(4)
  return { boardId, todo, list }
}

// Picking several, by box, by row, by range; restoring them together with what each needs
// decided already proposed in sight; deleting several for good after saying how much goes.
test('several things in the trash are picked, restored together and deleted for good together', async ({ page }) => {
  const { boardId, todo, list } = await fill(page)
  const toolbar = page.getByRole('toolbar', { name: 'Seleccionar todo' })
  const row = (name: string) => list.getByRole('listitem', { name }).first()
  const box = (name: string) => page.getByRole('checkbox', { name: `Seleccionar «${name}»` })

  // A click on the free part of a row picks it; Shift+click picks the range up to another.
  await row('Dos').getByText('Dos', { exact: true }).click()
  await expect(box('Dos')).toBeChecked()
  await expect(toolbar).toContainText('1 seleccionado')
  await box('Notas').click({ modifiers: ['Shift'] })
  await expect(toolbar).toContainText('3 seleccionados')
  await expect(box('Archivo')).toBeChecked()
  await expect(box('Uno')).not.toBeChecked()
  // Esc lets go of all of it.
  await page.keyboard.press('Escape')
  await expect(toolbar).not.toContainText('seleccionado')
  await expect(box('Notas')).not.toBeChecked()

  // Picking a board takes what it holds with it: shown ticked, and not counted twice.
  await page.getByRole('checkbox', { name: 'Seleccionar todo' }).click()
  await expect(toolbar).toContainText('4 seleccionados')
  await row('Archivo').getByRole('button', { name: 'Mostrar lo que contiene «Archivo»' }).click()
  await expect(box('Por hacer')).toBeChecked()
  await expect(box('Por hacer')).toBeDisabled()
  await expect(toolbar).toContainText('4 seleccionados')
  await page.getByRole('checkbox', { name: 'Seleccionar todo' }).click()
  await expect(toolbar).not.toContainText('seleccionado')

  // Restoring several: "Uno" finds its name taken, and a new one is proposed, in sight.
  await page.request.post(`/api/columns/${todo.id}/cards`, { data: { title: 'Uno' } })
  for (const name of ['Uno', 'Dos', 'Archivo']) await box(name).click()
  await toolbar.getByRole('button', { name: 'Restaurar' }).click()
  const dialog = page.getByRole('dialog', { name: 'Restaurar 3 elementos' })
  const items = dialog.getByRole('list', { name: 'Lo que se restaura' })
  await expect(items.getByRole('listitem', { name: 'Uno' })).toContainText('A su sitio: Mudanza › Tareas › Por hacer · se llamará «Uno (restaurado)»')
  await expect(items.getByRole('listitem', { name: 'Archivo' })).toContainText('A su sitio: Mudanza · con 4 elementos dentro')
  // Opened, all of it can be changed; unticked, it stays in the trash.
  await items.getByRole('button', { name: 'Cambiar cómo vuelve «Uno»' }).click()
  await items.getByRole('textbox', { name: 'Nombre para «Uno»' }).fill('Uno bis')
  await items.getByRole('button', { name: 'Cerrar los cambios de «Uno»' }).click()
  await expect(items.getByRole('listitem', { name: 'Uno' })).toContainText('se llamará «Uno bis»')
  await items.getByRole('checkbox', { name: 'Restaurar «Dos»' }).click()
  await expect(items.getByRole('listitem', { name: 'Dos' })).toContainText('Se queda en la papelera')
  await dialog.getByRole('button', { name: 'Restaurar todo (2)' }).click()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Se han restaurado 2 elementos' })).toBeVisible()
  await expect(dialog).toHaveCount(0)
  const back = await board(page.request, boardId)
  expect(back.cards.map((c) => c.title).sort()).toEqual(['Uno', 'Uno bis'])
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await expect(toolbar).not.toContainText('seleccionado')

  // Deleting several for good says how much goes, with what each holds, and asks first.
  await page.getByRole('checkbox', { name: 'Seleccionar todo' }).click()
  await toolbar.getByRole('button', { name: 'Borrar para siempre' }).click()
  const confirm = page.getByRole('alertdialog', { name: '¿Borrar para siempre 2 elementos?' }).or(page.getByRole('dialog', { name: '¿Borrar para siempre 2 elementos?' }))
  await expect(confirm).toContainText('Se borrarán con todo lo que contienen. En total: 1 tarjeta y 1 página. Después no se podrá recuperar.')
  await confirm.getByRole('button', { name: 'Borrar para siempre (2)' }).click()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Se han borrado 2 elementos para siempre' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'La papelera está vacía' })).toBeVisible()
})

// The tree by keyboard: from a row's box, down and up move between rows, right opens, left closes.
test('the trash is used by keyboard', async ({ page }) => {
  const { list } = await fill(page)
  const box = (name: string) => page.getByRole('checkbox', { name: `Seleccionar «${name}»` })
  await box('Notas').focus()
  await page.keyboard.press('ArrowDown')
  await expect(box('Archivo')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(list.getByRole('button', { name: 'Ocultar lo que contiene «Archivo»' })).toHaveAttribute('aria-expanded', 'true')
  await expect(box('Por hacer')).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await expect(box('Por hacer')).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowLeft')
  await expect(list.getByRole('button', { name: 'Mostrar lo que contiene «Archivo»' })).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('Space')
  await expect(box('Archivo')).toBeChecked()
  await expect(page.getByRole('status').or(page.locator('[aria-live="polite"]')).filter({ hasText: '1 seleccionado' })).toHaveCount(1)
})

// On a phone: two lines a row, the actions in a menu, and what is picked in a bar at the bottom.
test('on a phone, actions are in a menu and the bar for what is picked stays at the bottom', async ({ page }) => {
  const { list } = await fill(page)
  await page.setViewportSize({ width: 390, height: 780 })
  // At this width the sidebar is a drawer, open as it was: Esc closes it.
  await page.keyboard.press('Escape')
  const notes = list.getByRole('listitem', { name: 'Notas' })
  await expect(notes.getByRole('button', { name: 'Restaurar «Notas»' })).toBeHidden()
  await notes.getByRole('button', { name: 'Más acciones para «Notas»' }).click()
  await expect(page.getByRole('menuitem', { name: 'Restaurar' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('checkbox', { name: 'Seleccionar «Dos»' }).click()
  const toolbar = page.getByRole('toolbar', { name: 'Seleccionar todo' })
  await expect(toolbar).toContainText('1 seleccionado')
  const bar = (await toolbar.boundingBox())!
  expect(bar.y + bar.height).toBeGreaterThan(780 - 40)
  await expect(toolbar.getByRole('button', { name: 'Borrar para siempre' })).toBeVisible()
})
