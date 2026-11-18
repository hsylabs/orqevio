import { createProject, expect, openNewWorkspace, test } from './helpers'

// Agents archive a lot: a board with many cards still loads (a Cloudflare copy used to fail past
// 100), every archived card can be reached in the panel, and search finds them when asked to.
test('a board with many cards loads, and every archived card can be reached and found', async ({ page }, testInfo) => {
  test.setTimeout(240_000)
  await openNewWorkspace(page, 'Archivo E2E')
  const boardId = await createProject(page, 'Almacén')
  const { columns } = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string }> }
  const create = async (title: string) => {
    const res = await page.request.post(`/api/columns/${columns[0]!.id}/cards`, { data: { title } })
    expect(res.status(), await res.text()).toBe(201)
    return ((await res.json()) as { id: string }).id
  }
  const archive = async (id: string) => expect((await page.request.post(`/api/cards/${id}/archive`)).status()).toBe(204)

  // Away from the board while they are made: it would read itself again at each one.
  await page.getByRole('navigation').getByRole('link', { name: 'Inicio' }).click()
  const invoice = await create('Factura vieja de la imprenta')
  await archive(invoice)
  for (let i = 1; i <= 60; i++) await archive(await create(`Archivada ${String(i).padStart(2, '0')}`))
  for (let i = 1; i <= 110; i++) await create(`Abierta ${String(i).padStart(3, '0')}`)

  // More than 100 cards on the board.
  await page.getByRole('navigation').getByRole('link', { name: /^Tareas/ }).click()
  await page.waitForURL(`**/b/${boardId}`)
  await expect(page.getByRole('button', { name: 'Abierta 110' })).toBeVisible()

  await page.getByRole('button', { name: 'Archivadas' }).click()
  const panel = page.getByRole('dialog', { name: 'Tarjetas archivadas' })
  await expect(panel.getByText('Archivada 60')).toBeVisible()
  await expect(panel.getByText('50 de 61')).toBeVisible()
  await expect(panel.getByText('Archivada 10')).toBeHidden()
  await panel.getByRole('button', { name: 'Cargar más' }).scrollIntoViewIfNeeded()
  await panel.screenshot({ path: testInfo.outputPath('1-archivadas-cargar-mas.png'), animations: 'disabled' })
  await panel.getByRole('button', { name: 'Cargar más' }).click()
  // The oldest one is there too, and nothing is left to load.
  await expect(panel.getByText('Factura vieja de la imprenta')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Cargar más' })).toHaveCount(0)
  await panel.screenshot({ path: testInfo.outputPath('2-archivadas-todas.png'), animations: 'disabled' })
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()

  // Search leaves archived cards out, unless asked to include them.
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Buscar' })
  await palette.getByRole('combobox', { name: 'Paleta de comandos' }).fill('factura imprenta')
  await expect(palette.getByText('Sin resultados. Prueba con otras palabras.')).toBeVisible()
  await palette.getByLabel('Incluir archivadas').check()
  const found = palette.getByRole('option', { name: /Factura vieja de la imprenta/ })
  await expect(found).toContainText('Archivada · ')
  await page.screenshot({ path: testInfo.outputPath('3-busqueda-con-archivadas.png'), animations: 'disabled' })
  await found.click()
  await expect(page.getByLabel('Título de la tarjeta')).toHaveValue('Factura vieja de la imprenta')
})
