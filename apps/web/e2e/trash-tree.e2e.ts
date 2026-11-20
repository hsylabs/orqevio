import type { APIRequestContext } from '@playwright/test'
import { createProject, expect, openNewWorkspace, test } from './helpers'

type Board = { id: string; projectId: string; columns: Array<{ id: string; name: string }>; cards: Array<{ id: string; title: string; columnId: string }> }
const board = async (request: APIRequestContext, id: string) => (await (await request.get(`/api/boards/${id}`)).json()) as Board
const remove = async (request: APIRequestContext, url: string) => expect((await request.delete(url)).status()).toBe(200)

// The owner's case: columns deleted, then their board, then its project. Restoring a column
// brings it back where it was, with the board and the project, and never into another project.
test('a column whose board and project are in the trash goes back there, with them and only them', async ({ page }, testInfo) => {
  const workspaceId = await openNewWorkspace(page, 'Árbol E2E')
  const webAgent = await createProject(page, 'WebAgent')
  const tasks = await createProject(page, 'xxx')
  const before = await board(page.request, webAgent)
  const xxx = await board(page.request, tasks)
  const doing = xxx.columns.find((c) => c.name === 'En curso')!
  const done = xxx.columns.find((c) => c.name === 'Hecho')!
  await page.request.post(`/api/columns/${doing.id}/cards`, { data: { title: 'Diseñar portada' } })
  // Away from the board first: an open board that is deleted asks for itself again, and finds nothing.
  // From the sidebar, as a person would: loading anew cuts short requests, which WebKit reports as errors.
  await page.getByRole('navigation').getByRole('link', { name: 'Papelera' }).click()
  await expect(page).toHaveURL(`/w/${workspaceId}/trash`)
  await remove(page.request, `/api/columns/${doing.id}`)
  await remove(page.request, `/api/columns/${done.id}`)
  await remove(page.request, `/api/boards/${tasks}`)
  await remove(page.request, `/api/projects/${xxx.projectId}`)

  const list = page.getByRole('list', { name: 'Papelera' })
  await expect(list.getByRole('listitem')).toHaveCount(1)
  const project = list.getByRole('listitem', { name: 'xxx' })
  await expect(project).toContainText('Proyecto · 1 tablero, 3 columnas y 1 tarjeta')
  await project.getByRole('button', { name: 'Mostrar lo que contiene «xxx»' }).click()
  const inside = project.getByRole('list', { name: 'Dentro de «xxx»' })
  await expect(inside.getByRole('listitem', { name: 'Tareas' })).toContainText('Borrado antes')
  await inside.getByRole('button', { name: 'Mostrar lo que contiene «Tareas»' }).click()
  const column = inside.getByRole('listitem', { name: 'En curso' })
  await expect(column).toContainText('Borrado antes')
  await page.screenshot({ path: testInfo.outputPath('1-papelera-en-arbol.png'), animations: 'disabled' })

  await column.getByRole('button', { name: 'Restaurar «En curso»' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Restaurar «En curso»' })
  await expect(dialog.getByRole('checkbox', { name: 'Incluir «Diseñar portada»' })).toBeChecked()
  await expect(dialog.getByRole('radio', { name: 'Recrear su sitio' })).toBeChecked()
  await expect(dialog).toContainText('Vuelve también el proyecto «xxx» y el tablero «Tareas», y solo eso')
  await expect(dialog).toContainText('Irá a xxx › Tareas')
  await page.screenshot({ path: testInfo.outputPath('2-restaurar-recreando-su-sitio.png'), animations: 'disabled' })
  await dialog.getByRole('button', { name: 'Restaurar', exact: true }).click()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Se ha restaurado «En curso»' })).toContainText('Está en xxx › Tareas.')

  const back = await board(page.request, tasks)
  expect([back.projectId, back.columns.map((c) => c.name), back.cards.map((c) => c.title)]).toEqual([xxx.projectId, ['En curso'], ['Diseñar portada']])
  expect((await board(page.request, webAgent)).columns.map((c) => c.id)).toEqual(before.columns.map((c) => c.id))
  // The rest stays in the trash, each now straight back to its place.
  await expect(list.getByRole('listitem', { name: 'Hecho' })).toContainText('Columna · xxx › Tareas')
  await expect(list.getByRole('listitem', { name: 'Por hacer' })).toContainText('Columna · xxx › Tareas')
  await list.getByRole('listitem', { name: 'Hecho' }).getByRole('button', { name: 'Restaurar «Hecho»' }).click()
  await expect(page.getByText('Se ha restaurado «Hecho»')).toBeVisible()
  expect((await board(page.request, tasks)).columns.map((c) => c.name)).toEqual(['En curso', 'Hecho'])
})

// A card whose board is in the trash: put somewhere else, chosen by the person; a name already
// used there is asked about; and the activity sends what is in the trash to the trash.
test('a card is put where the person chooses, a repeated name is asked about, and the activity leads to the trash', async ({ page }, testInfo) => {
  const workspaceId = await openNewWorkspace(page, 'Otro sitio E2E')
  const target = await createProject(page, 'Destino')
  const gone = await createProject(page, 'Origen')
  const source = await board(page.request, gone)
  const card = (await (await page.request.post(`/api/columns/${source.columns[0]!.id}/cards`, { data: { title: 'Factura' } })).json()) as { id: string }
  const destination = await board(page.request, target)
  await page.request.post(`/api/columns/${destination.columns[1]!.id}/cards`, { data: { title: 'Factura' } })
  await page.getByRole('navigation').getByRole('link', { name: 'Papelera' }).click()
  await expect(page).toHaveURL(`/w/${workspaceId}/trash`)
  await remove(page.request, `/api/cards/${card.id}`)
  await remove(page.request, `/api/boards/${gone}`)

  // The activity says the card is in the trash, and opens it there.
  await page.getByRole('navigation').getByRole('link', { name: 'Inicio' }).click()
  await expect(page).toHaveURL(`/w/${workspaceId}`)
  const created = page.getByRole('listitem').filter({ hasText: /creó la tarjeta «Factura»/ }).filter({ hasText: 'en la papelera' })
  await created.getByRole('link', { name: '«Factura»' }).click()
  await expect(page).toHaveURL(`/w/${workspaceId}/trash?item=${encodeURIComponent(`card:${card.id}`)}`)
  const row = page.getByRole('list', { name: 'Dentro de «Tareas»' }).getByRole('listitem', { name: 'Factura' })
  await expect(row).toBeVisible()

  await row.getByRole('button', { name: 'Restaurar «Factura»' }).click()
  const dialog = page.getByRole('dialog', { name: 'Restaurar «Factura»' })
  await dialog.getByRole('radio', { name: 'En otro sitio' }).check()
  await expect(dialog.getByRole('button', { name: 'Restaurar', exact: true })).toBeDisabled()
  await dialog.getByLabel('Proyecto').selectOption({ label: 'Destino' })
  await dialog.getByLabel('Tablero').selectOption({ label: 'Tareas' })
  await dialog.getByLabel('Columna').selectOption({ label: 'En curso' })
  await expect(dialog).toContainText('Ya hay una tarjeta «Factura» en «En curso».')
  const name = dialog.getByRole('textbox', { name: 'Nombre para «Factura»' })
  await expect(name).toHaveValue('Factura (restaurado)')
  await expect(dialog).toContainText('Irá a Destino › Tareas › En curso')
  await page.screenshot({ path: testInfo.outputPath('3-restaurar-en-otro-sitio.png'), animations: 'disabled' })
  await dialog.getByRole('button', { name: 'Restaurar', exact: true }).click()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Se ha restaurado «Factura»' })).toContainText('Está en Destino › Tareas › En curso.')
  const there = await board(page.request, target)
  expect(there.cards.filter((c) => c.columnId === destination.columns[1]!.id).map((c) => c.title).sort()).toEqual(['Factura', 'Factura (restaurado)'])
  // Its board, deleted after it, is still in the trash.
  await expect(page.getByRole('list', { name: 'Papelera' }).getByRole('listitem', { name: 'Tareas' })).toBeVisible()
})
