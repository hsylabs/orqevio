import path from 'node:path'
import { type Page, test as base, expect } from '@playwright/test'

/** Test fixture that fails the test on any uncaught page error or console error. */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      // Every browser blocks CSP violations, but not all of them log one: report them all.
      await page.addInitScript(() =>
        document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.effectiveDirective} blocked ${e.blockedURI || 'inline code'} in ${e.sourceFile}`)),
      )
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

/** Must match the server's SETUP_CODE; the CI sets both. */
export const SETUP_CODE = process.env.SETUP_CODE ?? 'e2e-setup-code-1234'
/** Browser state of the owner, saved by setup.e2e.ts once the copy is claimed. */
export const OWNER_STATE = path.join(process.cwd(), 'e2e/.auth/owner.json')
/** The owner's current access key, written by setup.e2e.ts. */
export const ACCESS_KEY_FILE = path.join(process.cwd(), 'e2e/.auth/access-key.txt')

/** Each test works in a workspace of its own inside the shared copy. */
export async function openNewWorkspace(page: Page, name: string) {
  const res = await page.request.post('/api/workspaces', { data: { name } })
  expect(res.status(), await res.text()).toBe(201)
  const { id } = (await res.json()) as { id: string }
  await page.goto(`/w/${id}`)
  await expect(page.getByRole('button', { name: 'Nuevo proyecto' }).first()).toBeVisible()
  return id
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
