import { expect, test } from './helpers'

/** Has the page ask the copy for something just as it is left, the way a live refresh could. */
const askOnLeaving = (page: import('@playwright/test').Page) =>
  page.evaluate(() => addEventListener('pagehide', () => void fetch('/api/auth/session').catch(() => {})))

// WebKit reports a request that a page starts while it is being left as an uncaught error, even
// when the page catches it (refusedRequest in browser-noise.ts). Nothing failed for the person
// using the app, so it does not fail the test either; any other error still does.
test('a request the page starts as it is reloaded or left is not taken for an error of the app', async ({ page }) => {
  await page.goto('/')
  const home = page.getByRole('heading', { level: 1 })
  await expect(home).toBeVisible()
  for (let reload = 1; reload <= 3; reload++) {
    await askOnLeaving(page)
    await page.reload()
    await expect(home).toBeVisible()
  }
  await askOnLeaving(page)
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Clave de acceso' })).toBeVisible()
})
