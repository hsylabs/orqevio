import { readFile, writeFile } from 'node:fs/promises'
import { ACCESS_KEY_FILE, behindProxy, expect, openNewWorkspace, test } from './helpers'

test('replace the access key from Settings', async ({ page }) => {
  await openNewWorkspace(page, 'Ajustes E2E')
  const oldKey = (await readFile(ACCESS_KEY_FILE, 'utf8')).trim()
  await page.getByRole('button', { name: /Lucía Martín/ }).click()
  await page.getByRole('menuitem', { name: 'Ajustes' }).click()
  await expect(page.getByRole('heading', { name: 'Clave de acceso' })).toBeVisible()
  await page.getByLabel('Clave actual').fill(oldKey)
  await page.getByRole('button', { name: 'Generar una clave nueva' }).click()

  const dialog = page.getByRole('dialog', { name: 'Tu nueva clave de acceso' })
  await expect(dialog).toBeVisible()
  const newKey = (await dialog.getByLabel('Clave de acceso', { exact: true }).innerText()).trim()
  expect(newKey).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/)
  expect(newKey).not.toBe(oldKey)
  // It cannot be dismissed before confirming that the new key is saved.
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cerrar' })).toHaveCount(0)
  await dialog.getByLabel(/La he guardado en un lugar seguro/).check()
  await dialog.getByRole('button', { name: 'Hecho' }).click()
  await expect(dialog).toBeHidden()
  await writeFile(ACCESS_KEY_FILE, newKey)

  // This session stays open, and only the new key signs in.
  const me = await page.request.get('/api/auth/me')
  expect(me.status()).toBe(200)
  const fresh = await page.context().browser()!.newContext({ ...behindProxy, baseURL: new URL(page.url()).origin })
  const attempt = await fresh.request.post('/api/auth/login', { data: { accessKey: newKey } })
  expect(attempt.status()).toBe(200)
  await fresh.close()
})

// What Backups says is kept is what is kept, and errors of backups and uploads come in the app's language.
test('Backups says the ones made by hand are kept apart, and an empty file is said in Spanish', async ({ page, consoleErrors }, testInfo) => {
  const workspaceId = await openNewWorkspace(page, 'Mensajes E2E')
  const project = (await (await page.request.post(`/api/workspaces/${workspaceId}/projects`, { data: { name: 'Avisos' } })).json()) as { id: string }
  const board = (await (await page.request.post(`/api/projects/${project.id}/boards`, { data: { name: 'Tareas' } })).json()) as { id: string }
  const { columns } = (await (await page.request.get(`/api/boards/${board.id}`)).json()) as { columns: Array<{ id: string }> }
  await page.request.post(`/api/columns/${columns[0]!.id}/cards`, { data: { title: 'Con un archivo vacío' } })

  await page.getByRole('button', { name: /Lucía Martín/ }).click()
  await page.getByRole('menuitem', { name: 'Ajustes' }).click()
  await expect(page.getByText('Se conservan las 7 últimas copias diarias, las 7 últimas hechas por ti y la hecha antes de la última restauración.')).toBeVisible()

  // To the board in the app, as a link does: a new load here races the requests still in flight in WebKit.
  await page.evaluate((to) => {
    window.history.pushState(null, '', to)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, `/w/${workspaceId}/b/${board.id}`)
  await page.getByRole('button', { name: 'Con un archivo vacío' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Adjuntar archivo' }).click()
  await (await chooser).setFiles({ name: 'vacio.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) })
  await expect(page.getByText('vacio.txt: El archivo está vacío.')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('3-archivo-vacio-en-castellano.png'), animations: 'disabled' })
  // The browser logs the refused upload itself.
  const refused = /status of 400/
  consoleErrors.splice(0, consoleErrors.length, ...consoleErrors.filter((e) => !refused.test(e)))
})
