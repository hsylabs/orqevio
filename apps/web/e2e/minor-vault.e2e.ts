import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { ACCESS_KEY_FILE, expect, openNewWorkspace, settle, test } from './helpers'

const MASTER = 'frase maestra larga para probar'

/** From no vault, whatever the other tests did with the owner's: a new one with these items, oldest first. */
async function vaultWith(page: Page, titles: string[]) {
  const accessKey = (await readFile(ACCESS_KEY_FILE, 'utf8')).trim()
  expect((await page.request.post('/api/vault/reset', { data: { accessKey } })).status()).toBe(204)
  await openNewWorkspace(page, 'Bóveda pequeña')
  const toggle = page.getByRole('button', { name: 'Alternar barra lateral' })
  if (await toggle.isVisible()) await toggle.click()
  await page.getByRole('link', { name: /^Bóveda/ }).click()
  await page.getByLabel('Contraseña maestra', { exact: true }).fill(MASTER)
  await page.getByLabel('Repite la contraseña maestra').fill(MASTER)
  await page.getByRole('button', { name: 'Crear bóveda' }).click()
  await page.getByLabel('La he guardado en un lugar seguro, fuera de Orqevio.').check({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Abrir mi bóveda' }).click()
  for (const title of titles) {
    await page.getByRole('button', { name: 'Nuevo', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Credencial' }).click()
    await page.getByLabel('Nombre').fill(title)
    await page.getByLabel('Contraseña', { exact: true }).fill('una-contraseña-cualquiera')
    await page.getByRole('button', { name: 'Cifrar y guardar' }).click()
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    // On a phone the saved item covers the list.
    const back = page.getByRole('button', { name: '← Volver' })
    if (await back.isVisible()) await back.click()
  }
}

async function reopen(page: Page) {
  await page.reload()
  await page.getByLabel('Contraseña maestra').fill(MASTER)
  await page.getByRole('button', { name: 'Desbloquear' }).click()
  await expect(page.getByRole('textbox', { name: 'Buscar en la bóveda' })).toBeVisible()
}

test('the vault opens on the first item of its list, finds without accents, and forgets a cancelled password change', async ({ page }) => {
  test.setTimeout(90_000)
  await vaultWith(page, ['Zapatería', 'Música en casa'])
  await reopen(page)
  // The first of the list, not the oldest.
  await expect(page.getByRole('heading', { name: 'Música en casa' })).toBeVisible()

  const list = page.getByRole('list', { name: 'Elementos de la bóveda' })
  await page.getByRole('textbox', { name: 'Buscar en la bóveda' }).fill('musica')
  await expect(list.getByRole('button')).toHaveText([/Música en casa/])
  await page.getByRole('textbox', { name: 'Buscar en la bóveda' }).fill('ZAPATERIA')
  await expect(list.getByRole('button')).toHaveText([/Zapatería/])

  await page.getByRole('button', { name: 'Opciones de la bóveda' }).click()
  await page.getByRole('menuitem', { name: 'Cambiar contraseña maestra' }).click()
  const dialog = page.getByRole('dialog', { name: 'Cambiar contraseña maestra' })
  await dialog.getByLabel('Contraseña maestra actual').fill(MASTER)
  await dialog.getByRole('button', { name: 'Cancelar' }).click()
  await page.getByRole('button', { name: 'Opciones de la bóveda' }).click()
  await page.getByRole('menuitem', { name: 'Cambiar contraseña maestra' }).click()
  await expect(dialog.getByLabel('Contraseña maestra actual')).toHaveValue('')
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the vault opens on its list, with no item open', async ({ page }, testInfo) => {
    test.setTimeout(90_000)
    await vaultWith(page, ['Zapatería', 'Música en casa'])
    await reopen(page)
    await expect(page.getByRole('list', { name: 'Elementos de la bóveda' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Zapatería' })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('1-movil-abre-la-lista.png'), animations: 'disabled' })
  })
})

// Two tabs setting up the vault at once: the second one says its recovery key opens nothing, and goes on to unlock.
test('a vault set up in another tab first says the recovery key shown here opens nothing', async ({ page, context, baseURL }, testInfo) => {
  const accessKey = (await readFile(ACCESS_KEY_FILE, 'utf8')).trim()
  expect((await page.request.post('/api/vault/reset', { data: { accessKey } })).status()).toBe(204)
  await openNewWorkspace(page, 'Dos pestañas')
  const toggle = page.getByRole('button', { name: 'Alternar barra lateral' })
  if (await toggle.isVisible()) await toggle.click()
  await page.getByRole('link', { name: /^Bóveda/ }).click()
  await expect(page.getByRole('button', { name: 'Crear bóveda' })).toBeVisible()
  const other = await context.newPage()
  await settle(other, baseURL!)
  await other.goto(page.url())

  // Both get as far as their recovery key.
  for (const tab of [page, other]) {
    await tab.getByLabel('Contraseña maestra', { exact: true }).fill(MASTER)
    await tab.getByLabel('Repite la contraseña maestra').fill(MASTER)
    await tab.getByRole('button', { name: 'Crear bóveda' }).click()
    await expect(tab.getByRole('heading', { name: 'Guarda tu clave de recuperación' })).toBeVisible({ timeout: 30_000 })
  }
  // The first one opens its vault.
  await page.getByLabel('La he guardado en un lugar seguro, fuera de Orqevio.').check()
  await page.getByRole('button', { name: 'Abrir mi bóveda' }).click()
  await expect(page.getByRole('textbox', { name: 'Buscar en la bóveda' })).toBeVisible({ timeout: 30_000 })
  // The tab that set it up is not told its own key is no good.
  const ownWarning = page.getByText('La bóveda se configuró antes en otra pestaña o en otro dispositivo', { exact: false })
  await page.waitForTimeout(1_000)
  await expect(ownWarning).toHaveCount(0)

  // The other says its key is no good, at once or when it tries to open with it, and asks to unlock.
  const elsewhere = other.getByText('La bóveda se configuró antes en otra pestaña o en otro dispositivo', { exact: false })
  const opened = other.getByRole('button', { name: 'Abrir mi bóveda' })
  await expect(elsewhere.or(opened)).toBeVisible()
  if (!(await elsewhere.isVisible())) {
    await other.getByLabel('La he guardado en un lugar seguro, fuera de Orqevio.').check()
    await opened.click()
  }
  await expect(elsewhere).toBeVisible()
  await expect(other.getByRole('heading', { name: 'Bóveda bloqueada' })).toBeVisible()
  await expect(other.getByRole('heading', { name: 'Guarda tu clave de recuperación' })).toHaveCount(0)
  await other.screenshot({ path: testInfo.outputPath('1-la-otra-pestaña-dice-que-su-clave-no-sirve.png'), animations: 'disabled' })
  await other.close()
})

// Cancelling "Reset the vault" forgets the access key typed in it.
test('cancelling the vault reset forgets the access key typed', async ({ page }) => {
  await vaultWith(page, [])
  // Set up here, in a single tab: nothing says its recovery key is no good.
  await expect(page.getByText('La bóveda se configuró antes en otra pestaña o en otro dispositivo', { exact: false })).toHaveCount(0)
  await page.getByRole('button', { name: 'Bloquear' }).click()
  await page.getByRole('button', { name: '¿Has olvidado la contraseña maestra?' }).click()
  await page.getByRole('button', { name: 'No tengo la clave' }).click()
  const dialog = page.getByRole('dialog', { name: 'Restablecer la bóveda' })
  await dialog.getByLabel('Clave de acceso').fill('una-clave-de-acceso-cualquiera')
  await dialog.getByRole('button', { name: 'Cancelar' }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: 'No tengo la clave' }).click()
  await expect(page.getByRole('dialog', { name: 'Restablecer la bóveda' }).getByLabel('Clave de acceso')).toHaveValue('')
  // Closed with Escape, too.
  await page.getByRole('dialog', { name: 'Restablecer la bóveda' }).getByLabel('Clave de acceso').fill('otra-clave')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'No tengo la clave' }).click()
  await expect(page.getByRole('dialog', { name: 'Restablecer la bóveda' }).getByLabel('Clave de acceso')).toHaveValue('')
})
