import { createPageChain, createProject, expect, openNewWorkspace, test } from './helpers'

// A page 16 levels down is reached from the sidebar, level by level, with its title still readable;
// its path folds the levels in between into a menu instead of cutting them off.
test('a deep page tree opens to its last level in the sidebar, and its path folds', async ({ page }) => {
  await openNewWorkspace(page, 'Árbol profundo E2E')
  const boardId = await createProject(page, 'Manual')
  const { projectId } = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { projectId: string }
  const ids = await createPageChain(page.request, projectId, 16)

  const sidebar = page.getByRole('navigation').first()
  const level = (n: number) => sidebar.getByRole('link').filter({ hasText: new RegExp(`^Nivel ${n}$`) })
  await expect(level(1)).toBeVisible()
  for (let n = 1; n < 16; n++) {
    await level(n).getByRole('button', { name: 'Expandir' }).click()
    await expect(level(n + 1)).toBeVisible()
  }
  // The deepest title is not cut short: the indent stops growing.
  const label = level(16).locator('span.truncate')
  expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await level(16).click()
  await page.waitForURL(`**/d/${ids[15]}`)

  // Project / … / Nivel 14 / Nivel 15 / Nivel 16; the menu holds Nivel 1 to 13 and goes there.
  const path = page.getByRole('navigation', { name: 'Ruta' })
  await expect(path.getByRole('link')).toHaveText(['Manual', 'Nivel 14', 'Nivel 15'])
  await expect(path.locator('[aria-current="page"]')).toHaveText('Nivel 16')
  await path.getByRole('button', { name: 'Ver los niveles intermedios' }).click()
  const between = page.getByRole('menuitem')
  await expect(between).toHaveText(Array.from({ length: 13 }, (_, i) => `Nivel ${i + 1}`))
  await between.filter({ hasText: /^Nivel 7$/ }).click()
  await page.waitForURL(`**/d/${ids[6]}`)
  await expect(page.getByRole('navigation', { name: 'Ruta' }).locator('[aria-current="page"]')).toHaveText('Nivel 7')
})

// A page 40 levels down hears of a page far above it going to the trash, and can bring it back:
// the path used to stop at 32 levels, and so did that.
test('a page 40 levels down says a page far above it went to the trash, and brings it back', async ({ page }) => {
  await openNewWorkspace(page, 'Borrado profundo E2E')
  const boardId = await createProject(page, 'Archivo')
  const { projectId } = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { projectId: string }
  const ids = await createPageChain(page.request, projectId, 40)

  // Opened from the search, as people do with a page this deep.
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Buscar' })
  await palette.getByRole('combobox', { name: 'Paleta de comandos' }).fill('Nivel 40')
  await palette.getByRole('option', { name: /Nivel 40/ }).first().click()
  await page.waitForURL(`**/d/${ids[39]}`)
  await expect(page.locator('.orq-prose')).toBeVisible()

  // The top page goes, elsewhere: this one goes with it, and the notice offers it back.
  expect((await page.request.delete(`/api/pages/${ids[0]}`)).status()).toBe(200)
  await expect(page.getByText('Has borrado «Nivel 1» en otra pestaña o sesión, y esta página con ello.')).toBeVisible()
  await page.getByRole('button', { name: 'Restaurar' }).click()
  // Back where it was, with the 39 pages above it.
  const dialog = page.getByRole('dialog', { name: 'Restaurar «Nivel 40»' })
  await expect(dialog.getByText(/^Irá a Archivo › Nivel 1 › .* › Nivel 39$/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Restaurar' }).click()
  await expect(page.getByText(/y esta página con ello/)).toBeHidden()
  const back = (await (await page.request.get(`/api/pages/${ids[39]}`)).json()) as { breadcrumbs: Array<{ id: string }> }
  expect(back.breadcrumbs.map((b) => b.id)).toEqual(ids.slice(0, 39))
})
