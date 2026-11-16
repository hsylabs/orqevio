import { readFile } from 'node:fs/promises'
import { ACCESS_KEY_FILE, createProject, expect, settle, test } from './helpers'

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

// Another tab signs out and back in: a new session for the same person. This tab's live connection
// still holds the old one, so the server closes it at the next ping; the tab must connect again
// with the new session, not stop receiving changes.
test('a tab keeps its live updates when another tab signs out and back in', async ({ browser, baseURL }) => {
  test.setTimeout(90_000)
  const accessKey = (await readFile(ACCESS_KEY_FILE, 'utf8')).trim()
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  await settle(page, baseURL!)
  await page.goto('/login')
  await page.getByLabel('Clave de acceso', { exact: true }).fill(accessKey)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Nuevo proyecto' }).first()).toBeVisible()
  const boardId = await createProject(page, 'En directo')
  const board = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string }> }

  const other = await context.newPage()
  await settle(other, baseURL!)
  const reconnected = page.waitForEvent('websocket', { timeout: 40_000 })
  const status = await other.evaluate(async (key) => {
    await fetch('/api/auth/logout', { method: 'POST' })
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessKey: key }) })
    return res.status
  }, accessKey)
  expect(status).toBe(200)
  await reconnected

  // Changes keep arriving live, and the tab stays where it was.
  await other.evaluate(
    async (columnId) =>
      (await fetch(`/api/columns/${columnId}/cards`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Llega en directo' }) })).status,
    board.columns[0]!.id,
  )
  await expect(page.getByRole('button', { name: 'Llega en directo' })).toBeVisible({ timeout: 5000 })
  expect(page.url()).toContain(`/b/${boardId}`)
  await context.close()
})
