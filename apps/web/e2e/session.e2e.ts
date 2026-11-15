import { readFile } from 'node:fs/promises'
import { ACCESS_KEY_FILE, expect, settle, test } from './helpers'

// A tab whose session ended elsewhere goes to the sign-in screen. Signing in again there must
// open the app once, not bounce between the app and the sign-in screen opening connections.
test('signing in again in a tab whose session ended opens the app once', async ({ browser, baseURL }) => {
  test.setTimeout(90_000)
  const accessKey = (await readFile(ACCESS_KEY_FILE, 'utf8')).trim()
  // A session of its own: ending the owner's would sign the other tests out.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await settle(page, baseURL!)
  const signIn = async () => {
    await page.getByLabel('Clave de acceso', { exact: true }).fill(accessKey)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Nuevo proyecto' }).first()).toBeVisible()
  }
  await page.goto('/login')
  await signIn()
  const app = page.url()

  // Another tab of this browser signs out, which ends this tab's session too.
  const other = await context.newPage()
  await settle(other, baseURL!)
  expect(await other.evaluate(async () => (await fetch('/api/auth/logout', { method: 'POST' })).status)).toBeLessThan(300)
  await other.close()
  // The tab finds out with the next ping of its live connection, every 25 seconds.
  await expect(page).toHaveURL(/\/login/, { timeout: 40_000 })
  await expect(page.getByRole('heading', { name: 'Hola de nuevo' })).toBeVisible()

  // Signing in again: straight to where the tab was, and it stays there.
  const sockets: string[] = []
  page.on('websocket', (ws) => sockets.push(ws.url()))
  let navigations = 0
  page.on('framenavigated', () => navigations++)
  await signIn()
  expect(page.url()).toBe(app)
  await page.waitForTimeout(1500)
  expect(page.url()).toBe(app)
  await expect(page.getByRole('button', { name: 'Nuevo proyecto' }).first()).toBeVisible()
  expect(sockets.length, sockets.join('\n')).toBeLessThanOrEqual(1)
  expect(navigations).toBeLessThanOrEqual(3)

  // A workspace this person can't open says so, without trying to connect to it again and again.
  sockets.length = 0
  await page.goto('/w/00000000-0000-4000-8000-000000000000')
  await expect(page.getByRole('heading', { name: 'Aquí no hay nada' })).toBeVisible()
  await page.waitForTimeout(2500)
  expect(sockets).toEqual([])
  expect(errors).toEqual([])
  await context.close()
})
