import { readFile } from 'node:fs/promises'
import { ACCESS_KEY_FILE, OWNER_STATE, expect, openNewWorkspace, test } from './helpers'

// Runs after the other tests, in a project of its own (see playwright.config.ts): restoring
// a backup puts back the whole copy as it was and ends every session but this one.
test('back up the copy from Settings, then restore it: what changed since goes back', async ({ page }, testInfo) => {
  const accessKey = (await readFile(ACCESS_KEY_FILE, 'utf8')).trim()
  const workspaceId = await openNewWorkspace(page, 'Copias E2E')
  const project = (await (await page.request.post(`/api/workspaces/${workspaceId}/projects`, { data: { name: 'Mudanza' } })).json()) as { id: string }
  const board = (await (await page.request.post(`/api/projects/${project.id}/boards`, { data: { name: 'Tareas' } })).json()) as { id: string }
  const { columns } = (await (await page.request.get(`/api/boards/${board.id}`)).json()) as { columns: Array<{ id: string }> }
  const card = (await (await page.request.post(`/api/columns/${columns[0]!.id}/cards`, { data: { title: 'Antes de la copia' } })).json()) as { id: string }

  await page.getByRole('button', { name: /Lucía Martín/ }).click()
  await page.getByRole('menuitem', { name: 'Ajustes' }).click()
  await expect(page.getByRole('heading', { name: 'Copias de seguridad' })).toBeVisible()
  await page.getByRole('button', { name: 'Hacer una copia ahora' }).click()
  await expect(page.getByText('Copia de seguridad hecha')).toBeVisible()
  const list = page.getByRole('list', { name: 'Copias guardadas' })
  const mine = list.getByRole('listitem').filter({ hasText: 'Hecha por ti' })
  await expect(mine).toHaveCount(1)
  await mine.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('1-copias-de-seguridad.png') })

  // Something changes after the backup.
  expect((await page.request.patch(`/api/cards/${card.id}`, { data: { title: 'Después de la copia' } })).status()).toBe(200)

  await mine.getByRole('button', { name: 'Restaurar…' }).click()
  const dialog = page.getByRole('dialog', { name: '¿Restaurar esta copia de seguridad?' })
  await expect(dialog.getByText('Antes se hace una copia de seguridad de cómo está ahora')).toBeVisible()
  const confirm = dialog.getByRole('button', { name: 'Restaurar', exact: true })
  await dialog.getByLabel('Clave de acceso').fill(accessKey)
  const nameLabel = dialog.locator('label', { hasText: 'para confirmar' })
  const name = /«(.+)»/.exec(await nameLabel.innerText())![1]!
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel(await nameLabel.innerText()).fill(name)
  await page.screenshot({ path: testInfo.outputPath('2-restaurar.png') })
  const restored = page.waitForResponse((res) => res.url().endsWith('/restore'))
  await confirm.click()
  expect((await restored).status()).toBe(200)

  // The app starts again from the restored copy, still signed in, in the workspace it was in.
  // Waiting for it to get there (and going on from the sidebar) leaves none of its requests
  // in flight for a navigation to cut short, which Safari reports as a console error.
  await page.waitForURL(`**/w/${workspaceId}`)
  await page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: /^Tareas/ }).click()
  await page.waitForURL(`**/b/${board.id}`)
  await expect(page.getByRole('region', { name: 'Columna Por hacer' }).getByRole('button', { name: /Antes de la copia/ })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('3-restaurada.png') })

  // A backup of the copy as it was before restoring is kept apart.
  await page.goto(`/w/${workspaceId}/settings`)
  await expect(page.getByRole('list', { name: 'Copias guardadas' }).getByRole('listitem').filter({ hasText: 'Hecha antes de restaurar' })).toHaveCount(1)
  // Restoring ended every other session: the tests after this one use this one.
  await page.context().storageState({ path: OWNER_STATE })
})
