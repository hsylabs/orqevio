import path from 'node:path'
import { type APIRequestContext, type Page, test as base, expect } from '@playwright/test'
import { type Refusal, refusedRequest, unexplainedRefusals } from './browser-noise'

/**
 * A new tab's first navigation, the one that moves it from about:blank to another process,
 * is sometimes lost by the browser. Firefox loses its commit: Juggler reports the
 * navigation as started (twice) and the page loads and renders, but
 * Page.navigationCommitted never arrives, so page.goto waits until the test times out.
 * WebKit, now and then, does not start it at all: the tab stays on about:blank. Every new
 * page therefore first opens a tiny page of the copy, checks that one through the
 * document, and asks again when it is not there; the navigations of the tests are then
 * ordinary, fully tracked ones.
 */
export async function settle(page: Page, baseURL: string) {
  const there = () => page.evaluate(() => location.pathname).catch(() => '')
  for (let attempt = 1; ; attempt++) {
    const arrived = await Promise.race([
      page.goto(`${baseURL}/healthz`, { waitUntil: 'commit', timeout: 10_000 }).then(
        () => true,
        () => false,
      ),
      expect
        .poll(there, { timeout: 10_000 })
        .toBe('/healthz')
        .then(
          () => true,
          () => false,
        ),
    ])
    if (arrived || (await there()) === '/healthz') return
    if (attempt === 3) throw new Error(`A new page never reached ${baseURL}/healthz in three tries`)
  }
}

/**
 * Firefox logs a font whose download was cancelled (status NS_BINDING_ABORTED, 0x804B0002) as an
 * error: when the page starts a download or goes elsewhere while a font is still loading. Nothing
 * failed, and the font loads again when needed. Any other font error still counts. Playwright
 * hands the message over wrapped, as `[JavaScript Error: "downloadable font: …"]`.
 */
export const cancelledFontLoad = (text: string) => /\bdownloadable font: download failed \(.*\): status=2152398850\b/.test(text)

/**
 * Test fixture that fails the test on any uncaught page error or console error.
 * When a test fails, it also reports the page's load state and the requests still
 * in flight, to explain pages that never finish loading.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  page: async ({ page, baseURL }, use) => {
    await settle(page, baseURL!)
    await use(page)
  },
  consoleErrors: [
    async ({ page, baseURL }, use, testInfo) => {
      const inFlight = new Map<object, string>()
      page.on('request', (r) => inFlight.set(r, `${r.method()} ${r.url()} (${r.resourceType()}, since ${new Date().toISOString()})`))
      page.on('requestfinished', (r) => inFlight.delete(r))
      page.on('requestfailed', (r) => inFlight.delete(r))
      // Every browser blocks CSP violations, but not all of them log one: report them all.
      await page.addInitScript(() =>
        document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.effectiveDirective} blocked ${e.blockedURI || 'inline code'} in ${e.sourceFile}`)),
      )
      const errors: string[] = []
      // Requests WebKit refused as the page was left (see refusedRequest): judged once the
      // navigations around them are known.
      const refusals: Refusal[] = []
      const navigations: number[] = []
      page.on('framenavigated', (frame) => frame === page.mainFrame() && navigations.push(Date.now()))
      page.on('pageerror', (e) => {
        if (refusedRequest(`${e.name}: ${e.message}`, baseURL!)) refusals.push({ text: `pageerror: ${e.message}`, at: Date.now() })
        else errors.push(`pageerror: ${e.message}`)
      })
      page.on('console', (m) => {
        if (m.type() !== 'error' || cancelledFontLoad(m.text())) return
        if (refusedRequest(m.text(), baseURL!)) refusals.push({ text: `console: ${m.text()}`, at: Date.now() })
        else errors.push(`console: ${m.text()}`)
      })
      await use(errors)
      errors.push(...unexplainedRefusals(refusals, navigations).map((refusal) => refusal.text))
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

/**
 * For contexts a test opens itself, which do not take the configuration's options: the
 * password of the reverse proxy in front of the copy, when E2E_BASIC_AUTH gives one.
 */
export const behindProxy = (() => {
  const [username, ...password] = (process.env.E2E_BASIC_AUTH ?? '').split(':')
  return username ? { httpCredentials: { username, password: password.join(':') } } : {}
})()

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

/** Creates a chain of nested pages, each inside the previous one, and returns their ids from the top. */
export async function createPageChain(request: APIRequestContext, projectId: string, levels: number) {
  const ids: string[] = []
  for (let i = 0; i < levels; i++) {
    const res = await request.post(`/api/projects/${projectId}/pages`, { data: { title: `Nivel ${i + 1}`, parentId: ids.at(-1) ?? null } })
    expect(res.status(), await res.text()).toBe(201)
    ids.push(((await res.json()) as { id: string }).id)
  }
  return ids
}

export async function addCard(page: Page, column: string, title: string) {
  await page.getByRole('button', { name: `Añadir tarjeta a ${column}` }).click()
  await page.getByLabel('Título de la tarjeta').fill(title)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: `Columna ${column}` }).getByRole('button', { name: title })).toBeVisible()
  await page.keyboard.press('Escape')
}
