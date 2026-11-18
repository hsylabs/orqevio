import { readFile } from 'node:fs/promises'
import type { BrowserContext, Page } from '@playwright/test'
import { ACCESS_KEY_FILE, behindProxy, expect, openNewWorkspace, OWNER_STATE, settle, test } from './helpers'

const MASTER = 'frase maestra de los elementos'
const CHANGED = 'Este elemento ha cambiado en otra pestaña o en otro dispositivo.'

/** The text of the page once the open item's password is shown. */
async function shownPassword(page: Page) {
  const reveal = page.getByRole('button', { name: 'Mostrar contraseña' })
  if (await reveal.isVisible()) await reveal.click()
  return page.locator('body').innerText()
}

/** Sets the vault up in a new workspace with one login, `title`, and returns the vault's address. */
async function vaultWith(page: Page, title: string, password: string) {
  const workspaceId = await openNewWorkspace(page, 'Elementos E2E')
  await page.getByRole('link', { name: /^Bóveda/ }).click()
  await page.getByLabel('Contraseña maestra', { exact: true }).fill(MASTER)
  await page.getByLabel('Repite la contraseña maestra').fill(MASTER)
  await page.getByRole('button', { name: 'Crear bóveda' }).click()
  await page.getByLabel('La he guardado en un lugar seguro, fuera de Orqevio.').check({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Abrir mi bóveda' }).click()
  await page.getByRole('button', { name: 'Nueva credencial' }).click()
  await page.getByLabel('Nombre').fill(title)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Cifrar y guardar' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  return `/w/${workspaceId}/vault`
}

/** Opens the vault in `page` and waits for the item `title`, open beside the list. */
async function unlockIn(page: Page, baseURL: string, vaultUrl: string, title: string) {
  await settle(page, baseURL)
  await page.goto(vaultUrl)
  await page.getByLabel('Contraseña maestra').fill(MASTER)
  await page.getByRole('button', { name: 'Desbloquear' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 30_000 })
}

// One item open in two tabs of a browser, and on another device. What one saves, the others don't
// overwrite: the tabs follow at once, and a device with an older version is refused, then shows
// the item as it is now. A deleted item doesn't come back either.
test('a tab or device that shows an older version of an item cannot overwrite it, nor bring it back once deleted', async ({ page, context, browser, baseURL }) => {
  test.setTimeout(180_000)
  const accessKey = (await readFile(ACCESS_KEY_FILE, 'utf8')).trim()
  const reset = async () => expect((await page.request.post('/api/vault/reset', { data: { accessKey } })).status()).toBe(204)
  await reset()
  let other: Page | undefined
  let device: BrowserContext | undefined
  try {
    const vaultUrl = await vaultWith(page, 'Correo', 'Antigua-1111')

    // Another tab of this browser and another device, both with «Correo» open.
    other = await context.newPage()
    await unlockIn(other, baseURL!, vaultUrl, 'Correo')
    device = await browser.newContext({ ...behindProxy, baseURL, storageState: OWNER_STATE, locale: 'es-ES', timezoneId: 'Europe/Madrid', viewport: { width: 1440, height: 900 } })
    const far = await device.newPage()
    await unlockIn(far, baseURL!, vaultUrl, 'Correo')

    // The first tab changes the password.
    await page.getByRole('button', { name: 'Editar' }).click()
    await page.getByLabel('Contraseña', { exact: true }).fill('Nueva-2222')
    await page.getByRole('button', { name: 'Cifrar y guardar' }).click()
    await expect.poll(() => shownPassword(page)).toContain('Nueva-2222')

    // The other tab follows at once, and its star keeps the new password.
    await expect.poll(() => shownPassword(other!)).toContain('Nueva-2222')
    await other.getByRole('button', { name: 'Marcar como favorito' }).click()
    await expect(other.getByRole('button', { name: 'Quitar de favoritos' })).toBeVisible()

    // The device still shows the old password: its star is refused, and it shows the item as it is now.
    await far.getByRole('button', { name: 'Marcar como favorito' }).click()
    await expect(far.getByText(CHANGED)).toBeVisible()
    await expect.poll(() => shownPassword(far)).toContain('Nueva-2222')
    await expect(far.getByRole('button', { name: 'Quitar de favoritos' })).toBeVisible()

    // The first tab deletes it. The device, which has not heard, stars it: it doesn't come back.
    await page.getByRole('button', { name: 'Eliminar' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Eliminar' }).click()
    await expect(page.getByRole('heading', { name: 'Correo' })).toHaveCount(0)
    await expect(other.getByRole('heading', { name: 'Correo' })).toHaveCount(0)
    await far.getByRole('button', { name: 'Quitar de favoritos' }).click()
    await expect(far.getByText(CHANGED).first()).toBeVisible()
    await expect(far.getByRole('heading', { name: 'Correo' })).toHaveCount(0)
    const items = (await (await page.request.get('/api/vault/items')).json()) as unknown[]
    expect(items).toHaveLength(0)
  } finally {
    await device?.close()
    await other?.close()
    await reset()
  }
})

// An item being edited in one tab while another tab saves it: the edit is refused, and what was
// typed stays in the editor; saved again, it replaces the other change, which it now knows of.
test('an item edited while another tab saves it keeps what was typed, and saving it again replaces the other change', async ({ page, context, baseURL }) => {
  test.setTimeout(120_000)
  const accessKey = (await readFile(ACCESS_KEY_FILE, 'utf8')).trim()
  const reset = async () => expect((await page.request.post('/api/vault/reset', { data: { accessKey } })).status()).toBe(204)
  await reset()
  let other: Page | undefined
  try {
    const vaultUrl = await vaultWith(page, 'Banco', 'Uno-1111')
    other = await context.newPage()
    await unlockIn(other, baseURL!, vaultUrl, 'Banco')

    // The other tab starts editing; meanwhile, this one changes the password, and the other tab
    // follows, under its editor.
    await other.getByRole('button', { name: 'Editar' }).click()
    await other.getByLabel('Contraseña', { exact: true }).fill('Otra-3333')
    await page.getByRole('button', { name: 'Editar' }).click()
    await page.getByLabel('Contraseña', { exact: true }).fill('Dos-2222')
    await page.getByRole('button', { name: 'Cifrar y guardar' }).click()
    await expect.poll(() => shownPassword(page)).toContain('Dos-2222')

    // Its save is refused, and keeps what was typed.
    await other.getByRole('button', { name: 'Cifrar y guardar' }).click()
    await expect(other.getByText('Tus cambios siguen aquí: si vuelves a guardar, sustituirán a los otros.', { exact: false })).toBeVisible()
    await expect(other.getByLabel('Contraseña', { exact: true })).toHaveValue('Otra-3333')

    // Saved again, it replaces the other change, in both tabs.
    await other.getByRole('button', { name: 'Cifrar y guardar' }).click()
    await expect.poll(() => shownPassword(other!)).toContain('Otra-3333')
    await expect.poll(() => shownPassword(page)).toContain('Otra-3333')
    const items = (await (await page.request.get('/api/vault/items')).json()) as unknown[]
    expect(items).toHaveLength(1)
  } finally {
    await other?.close()
    await reset()
  }
})
