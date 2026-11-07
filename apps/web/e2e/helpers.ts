import { type Page, test as base, expect } from '@playwright/test'

/** Test fixture that fails the test on any uncaught page error or console error. */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console: ${m.text()}`)
      })
      await use(errors)
      expect(errors, 'browser console errors').toEqual([])
    },
    { auto: true },
  ],
})
export { expect }

export async function signUp(page: Page, name = 'Lucía Martín') {
  await page.goto('/register')
  await page.getByLabel('Nombre').fill(name)
  await page.getByLabel('Correo electrónico').fill(`e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`)
  await page.getByLabel('Contraseña', { exact: true }).fill('una-clave-segura-123')
  await page.getByRole('button', { name: 'Crear cuenta' }).click()
  await page.waitForURL(/\/w\/[0-9a-f-]{36}/)
  return page.url().split('/w/')[1]!.split('/')[0]!
}

export async function createProject(page: Page, name: string) {
  await page.getByRole('button', { name: 'Nuevo proyecto' }).first().click()
  await page.getByLabel('Nombre').fill(name)
  await page.getByRole('button', { name: 'Crear proyecto' }).click()
  await page.waitForURL(/\/b\/[0-9a-f-]{36}/)
  await expect(page.getByRole('region', { name: 'Columna Por hacer' })).toBeVisible()
  return page.url().split('/b/')[1]!.split('?')[0]!
}

export async function addCard(page: Page, column: string, title: string) {
  await page.getByRole('button', { name: `Añadir tarjeta a ${column}` }).click()
  await page.getByLabel('Título de la tarjeta').fill(title)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: `Columna ${column}` }).getByRole('button', { name: title })).toBeVisible()
  await page.keyboard.press('Escape')
}
