import { createProject, expect, openNewWorkspace, test } from './helpers'

// Search finds a word in the middle of a run of text written without spaces, as Japanese,
// Chinese or Thai are: in 1.5.0 only the start of the run was found.
test('the search finds a card by a word in the middle of Japanese or Chinese text', async ({ page }, testInfo) => {
  const workspaceId = await openNewWorkspace(page, 'Búsqueda CJK E2E')
  const boardId = await createProject(page, 'Notas')
  const columns = ((await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string }> }).columns
  for (const title of ['会議の議事録を作成する', '编写会议记录', 'Otra tarea']) {
    expect((await page.request.post(`/api/columns/${columns[0]!.id}/cards`, { data: { title } })).status()).toBe(201)
  }
  await page.goto(`/w/${workspaceId}/b/${boardId}`)
  await expect(page.getByText('会議の議事録を作成する')).toBeVisible()

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Buscar' })
  const query = palette.getByRole('combobox', { name: 'Paleta de comandos' })
  // Three characters or more, in the middle: 議事録 in 会議の議事録を作成する.
  await query.fill('議事録')
  await expect(palette.getByRole('option', { name: /会議の議事録を作成する/ })).toBeVisible()
  await expect(palette.getByRole('option', { name: /编写会议记录/ })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('busqueda-japones.png'), animations: 'disabled' })
  // One character is often a word in these languages: the search starts with it.
  await query.fill('録')
  await expect(palette.getByRole('option', { name: /会議の議事録を作成する/ })).toBeVisible()
  // Two characters, in the middle: 会议 in 编写会议记录.
  await query.fill('会议')
  const found = palette.getByRole('option', { name: /编写会议记录/ })
  await expect(found).toBeVisible()
  await expect(palette.getByRole('option', { name: /会議の議事録を作成する/ })).toHaveCount(0)
  await found.click()
  await expect(page.getByLabel('Título de la tarjeta')).toHaveValue('编写会议记录')
})
