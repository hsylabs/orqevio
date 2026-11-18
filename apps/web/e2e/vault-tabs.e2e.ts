import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { ACCESS_KEY_FILE, OWNER_STATE, expect, openNewWorkspace, settle, test } from './helpers'

const FIRST = 'primera frase maestra larga'
const SECOND = 'segunda frase maestra larga'
const THIRD = 'tercera frase maestra larga'
const CHANGED = 'La bóveda ha cambiado en otra pestaña o en otro dispositivo. Vuelve a abrirla.'

async function createVault(page: Page, password: string) {
  await page.getByLabel('Contraseña maestra', { exact: true }).fill(password)
  await page.getByLabel('Repite la contraseña maestra').fill(password)
  await page.getByRole('button', { name: 'Crear bóveda' }).click()
  await page.getByLabel('La he guardado en un lugar seguro, fuera de Orqevio.').check({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Abrir mi bóveda' }).click()
  await expect(page.getByRole('button', { name: 'Bloquear' })).toBeVisible()
}

async function unlock(page: Page, password: string) {
  await page.getByLabel('Contraseña maestra').fill(password)
  await page.getByRole('button', { name: 'Desbloquear' }).click()
}

// Two tabs of one browser, side by side and both in the foreground: what one does to the vault,
// the other follows at once. Another device, which nothing tells, can't save with an old key.
test('tabs follow the vault at once, and another device can no longer save with an old key', async ({ page, context, browser, baseURL }, testInfo) => {
  test.setTimeout(180_000)
  const accessKey = (await readFile(ACCESS_KEY_FILE, 'utf8')).trim()
  // From no vault to no vault, whatever the other tests do with the owner's.
  const reset = async () => expect((await page.request.post('/api/vault/reset', { data: { accessKey } })).status()).toBe(204)
  await reset()
  const workspaceId = await openNewWorkspace(page, 'Pestañas E2E')
  const vaultUrl = `/w/${workspaceId}/vault`
  await page.goto(vaultUrl)
  await createVault(page, FIRST)
  await page.getByRole('button', { name: 'Nueva credencial' }).click()
  await page.getByLabel('Nombre').fill('Banco')
  await page.getByLabel('Contraseña', { exact: true }).fill('S3cr3to-muy-largo!')
  await page.getByRole('button', { name: 'Cifrar y guardar' }).click()
  await expect(page.getByRole('heading', { name: 'Banco' })).toBeVisible()

  // A second tab, with the vault open with the first master password.
  const other = await context.newPage()
  const otherErrors: string[] = []
  other.on('pageerror', (e) => otherErrors.push(`pageerror: ${e.message}`))
  other.on('console', (m) => m.type() === 'error' && otherErrors.push(`console: ${m.text()}`))
  await settle(other, baseURL!)
  await other.goto(vaultUrl)
  await unlock(other, FIRST)
  await expect(other.getByRole('heading', { name: 'Banco' })).toBeVisible({ timeout: 30_000 })

  // The first tab changes the master password.
  await page.getByRole('button', { name: 'Opciones de la bóveda' }).click()
  await page.getByRole('menuitem', { name: 'Cambiar contraseña maestra' }).click()
  const change = page.getByRole('dialog', { name: 'Cambiar contraseña maestra' })
  await change.getByLabel('Contraseña maestra actual').fill(FIRST)
  await change.getByLabel('Nueva contraseña maestra').fill(SECOND)
  await change.getByLabel('Repite la nueva contraseña').fill(SECOND)
  await change.getByRole('button', { name: 'Cambiar' }).click()
  await expect(page.getByText('Contraseña maestra actualizada')).toBeVisible({ timeout: 30_000 })

  // The second tab, still open: an export takes the new master password, not the old one.
  await other.getByRole('button', { name: 'Opciones de la bóveda' }).click()
  await other.getByRole('menuitem', { name: 'Exportar…' }).click()
  const exporting = other.getByRole('dialog', { name: 'Exportar la bóveda' })
  await exporting.getByLabel('Contraseña maestra').fill(FIRST)
  await exporting.getByRole('button', { name: 'Exportar cifrada' }).click()
  await expect(exporting.getByText('Contraseña maestra incorrecta.')).toBeVisible({ timeout: 30_000 })
  await exporting.getByLabel('Contraseña maestra').fill(SECOND)
  const download = other.waitForEvent('download')
  await exporting.getByRole('button', { name: 'Exportar cifrada' }).click()
  await download
  // Locked, it opens with the new one only.
  await other.getByRole('button', { name: 'Bloquear' }).click()
  await unlock(other, FIRST)
  await expect(other.getByText('Contraseña maestra incorrecta.')).toBeVisible({ timeout: 30_000 })
  await unlock(other, SECOND)
  await expect(other.getByRole('heading', { name: 'Banco' })).toBeVisible({ timeout: 30_000 })

  // Another device: a browser of its own, signed in as the same person, with the vault open.
  const device = await browser.newContext({ baseURL, storageState: OWNER_STATE, locale: 'es-ES', timezoneId: 'Europe/Madrid', viewport: { width: 1440, height: 900 } })
  const far = await device.newPage()
  await settle(far, baseURL!)
  await far.goto(vaultUrl)
  await unlock(far, SECOND)
  await expect(far.getByRole('heading', { name: 'Banco' })).toBeVisible({ timeout: 30_000 })

  // The first tab resets the vault: the second one locks at once, says why, and offers to set it up.
  await page.getByRole('button', { name: 'Bloquear' }).click()
  await page.getByRole('button', { name: '¿Has olvidado la contraseña maestra?' }).click()
  await page.getByRole('button', { name: 'No tengo la clave' }).click()
  const resetting = page.getByRole('dialog', { name: 'Restablecer la bóveda' })
  await resetting.getByLabel('Clave de acceso').fill(accessKey)
  await resetting.getByRole('button', { name: 'Borrar y restablecer' }).click()
  await expect(page.getByText('Bóveda restablecida. Puedes configurarla de nuevo.')).toBeVisible()
  await expect(other.getByText(CHANGED)).toBeVisible()
  await expect(other.getByRole('button', { name: 'Crear bóveda' })).toBeVisible()
  await other.screenshot({ path: testInfo.outputPath('1-otra-pestana-tras-restablecer.png'), animations: 'disabled' })

  // Set up again, with a new key: the second tab opens the new vault, empty.
  await createVault(page, THIRD)
  await unlock(other, THIRD)
  await expect(other.getByRole('button', { name: 'Bloquear' })).toBeVisible({ timeout: 30_000 })
  await expect(other.getByRole('button', { name: 'Nueva credencial' })).toBeVisible()
  await expect(other.getByText('Banco')).toHaveCount(0)

  // The other device still holds the old key: what it saves is refused, and it locks.
  await far.getByRole('button', { name: 'Nuevo', exact: true }).click()
  await far.getByRole('menuitem', { name: 'Credencial' }).click()
  await far.getByLabel('Nombre').fill('Nadie podría abrirla')
  await far.getByRole('button', { name: 'Cifrar y guardar' }).click()
  await expect(far.getByText(CHANGED)).toBeVisible()
  await expect(far.getByRole('button', { name: 'Desbloquear' })).toBeVisible()
  await far.screenshot({ path: testInfo.outputPath('2-otro-dispositivo-rechazado.png'), animations: 'disabled' })
  expect(await page.evaluate(async () => (await (await fetch('/api/vault/items')).json()) as unknown[])).toEqual([])

  await device.close()
  await other.close()
  expect(otherErrors, 'console errors in the second tab').toEqual([])
  await reset()
})
