import path from 'node:path'
import { type Page, test as base, expect } from '@playwright/test'

/**
 * Test fixture that fails the test on any uncaught page error or console error.
 * When a test fails, it also reports the page's load state and the requests still
 * in flight, to explain pages that never finish loading.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use, testInfo) => {
      const inFlight = new Map<object, string>()
      page.on('request', (r) => inFlight.set(r, `${r.method()} ${r.url()} (${r.resourceType()}, since ${new Date().toISOString()})`))
      page.on('requestfinished', (r) => inFlight.delete(r))
      page.on('requestfailed', (r) => inFlight.delete(r))
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
      if (testInfo.status !== testInfo.expectedStatus) {
        const state = await Promise.race([
          page.evaluate(() => ({
            url: location.href,
            readyState: document.readyState,
            painted: document.getElementById('root')?.childElementCount ?? 0,
            unfinished: performance
              .getEntriesByType('resource')
              .filter((e) => (e as PerformanceResourceTiming).responseEnd === 0)
              .map((e) => e.name),
          })),
          new Promise((resolve) => setTimeout(() => resolve('the page did not answer'), 5000)),
        ]).catch((error: Error) => `the page could not be inspected: ${error.message}`)
        const report = JSON.stringify({ page: state, requestsInFlight: [...inFlight.values()] }, null, 2)
        console.log(`Page diagnostics for "${testInfo.title}":\n${report}`)
        await testInfo.attach('page-diagnostics', { body: report, contentType: 'application/json' })
      }
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

/**
 * Opens `url` and waits until the browser has finished loading the page, as the
 * document itself reports it. Firefox sometimes delivers the load event of a new
 * tab's initial about:blank late; Playwright then keeps waiting for the load of the
 * real page although the browser fired it (seen: readyState "complete" and
 * loadEventEnd ~230 ms while page.goto waited 60 s). Asking the document keeps the
 * check as strict without depending on that event.
 */
export async function open(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'commit' })
  await expect.poll(() => page.evaluate(() => document.readyState), { message: `${url} finished loading` }).toBe('complete')
}

/** Each test works in a workspace of its own inside the shared copy. */
export async function openNewWorkspace(page: Page, name: string) {
  const res = await page.request.post('/api/workspaces', { data: { name } })
  expect(res.status(), await res.text()).toBe(201)
  const { id } = (await res.json()) as { id: string }
  await open(page, `/w/${id}`)
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
