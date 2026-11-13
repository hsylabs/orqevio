import { writeFile } from 'node:fs/promises'
import { ACCESS_KEY_FILE, OWNER_STATE, SETUP_CODE, expect, open, test } from './helpers'

// Runs once before the other tests: claims the copy through the UI, checks
// signing in with the access key and saves the owner's session for the rest.
test('claim the copy and sign in with the access key', async ({ page }) => {
  await open(page, '/')
  await page.waitForURL(/\/setup$/)
  await page.getByLabel('Código de configuración', { exact: true }).fill(SETUP_CODE)
  await page.getByLabel('Tu nombre').fill('Lucía Martín')
  await page.getByRole('button', { name: 'Configurar' }).click()

  await expect(page.getByRole('heading', { name: 'Guarda tu clave de acceso' })).toBeVisible()
  const accessKey = (await page.getByLabel('Clave de acceso', { exact: true }).innerText()).trim()
  expect(accessKey).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/)
  const enter = page.getByRole('button', { name: 'Entrar en Orqevio' })
  await expect(enter).toBeDisabled()
  await page.getByLabel(/La he guardado en un lugar seguro/).check()
  await enter.click()
  await page.waitForURL(/\/w\/[0-9a-f-]{36}/)
  await expect(page.getByRole('button', { name: 'Nuevo proyecto' }).first()).toBeVisible()

  // Sign out from the account menu, then back in with the key (case and dashes do not matter).
  await page.getByRole('button', { name: /Lucía Martín/ }).click()
  await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click()
  await page.waitForURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Hola de nuevo' })).toBeVisible()
  await page.getByLabel('Clave de acceso', { exact: true }).fill(accessKey.toLowerCase().replaceAll('-', ''))
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForURL(/\/w\/[0-9a-f-]{36}/)

  await page.context().storageState({ path: OWNER_STATE })
  await writeFile(ACCESS_KEY_FILE, accessKey)
})
