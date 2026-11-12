import { expect, openNewWorkspace, test } from './helpers'

test('on an insecure address the vault explains what it needs, and the rest of the app keeps working', async ({ page }) => {
  // As when a copy is opened at http://<LAN address>: browsers then hide WebCrypto.
  await page.addInitScript(() => Object.defineProperty(window, 'isSecureContext', { value: false }))
  await openNewWorkspace(page, 'Navegador E2E')
  await page.getByRole('link', { name: /^Bóveda/ }).click()
  await expect(page.getByRole('heading', { name: 'La bóveda necesita una conexión segura' })).toBeVisible()
  await expect(page.getByText(/abre tu copia por https:\/\//)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Crear bóveda' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Inicio' }).click()
  await expect(page.getByRole('button', { name: 'Nuevo proyecto' }).first()).toBeVisible()
})
