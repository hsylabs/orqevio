import { readFile, writeFile } from 'node:fs/promises'
import { ACCESS_KEY_FILE, expect, openNewWorkspace, test } from './helpers'

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
  await dialog.getByLabel(/La he guardado en un lugar seguro/).check()
  await dialog.getByRole('button', { name: 'Hecho' }).click()
  await expect(dialog).toBeHidden()
  await writeFile(ACCESS_KEY_FILE, newKey)

  // This session stays open, and only the new key signs in.
  const me = await page.request.get('/api/auth/me')
  expect(me.status()).toBe(200)
  const fresh = await page.context().browser()!.newContext({ baseURL: new URL(page.url()).origin })
  const attempt = await fresh.request.post('/api/auth/login', { data: { accessKey: newKey } })
  expect(attempt.status()).toBe(200)
  await fresh.close()
})
