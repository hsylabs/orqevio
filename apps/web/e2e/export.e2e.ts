import { readFile } from 'node:fs/promises'
import { ACCESS_KEY_FILE, behindProxy, expect, openNewWorkspace, settle, test } from './helpers'

test('download the data as a ZIP from Settings', async ({ page }, testInfo) => {
  const workspaceId = await openNewWorkspace(page, 'Exportar E2E')
  const project = (await (await page.request.post(`/api/workspaces/${workspaceId}/projects`, { data: { name: 'Mudanza' } })).json()) as { id: string }
  await page.request.post(`/api/projects/${project.id}/pages`, { data: { title: 'Inventario', content: '# Inventario' } })

  await page.goto(`/w/${workspaceId}/settings`)
  const section = page.getByRole('heading', { name: 'Exportar tus datos' })
  await expect(section).toBeVisible()
  await section.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('1-exportar.png') })
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar un ZIP' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^orqevio-\d{4}-\d{2}-\d{2}\.zip$/)
  const zip = await readFile((await file.path())!)
  // A ZIP (its contents are checked in the server's tests), with this workspace's documents and tasks.
  expect(zip.subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004')
  const names = zip.toString('utf8')
  expect(names).toContain('/Exportar E2E/documents/Mudanza/Inventario.md')
  expect(names).toContain('/Exportar E2E/tasks.json')
  // The page stays where it was.
  await expect(section).toBeVisible()
})

// With the session ended, "Download a ZIP" asks to sign in again instead of opening the server's error.
test('downloading the ZIP with the session ended asks to sign in, not a JSON error', async ({ browser, baseURL, consoleErrors }) => {
  const accessKey = (await readFile(ACCESS_KEY_FILE, 'utf8')).trim()
  // A session of its own: ending the owner's would sign the other tests out.
  const context = await browser.newContext({ ...behindProxy, storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  await settle(page, baseURL!)
  await page.goto('/login')
  await page.getByLabel('Clave de acceso', { exact: true }).fill(accessKey)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Nuevo proyecto' }).first()).toBeVisible()
  await page.getByRole('button', { name: /Lucía Martín/ }).click()
  await page.getByRole('menuitem', { name: 'Ajustes' }).click()
  await expect(page.getByRole('heading', { name: 'Exportar tus datos' })).toBeVisible()

  // The session ends elsewhere (another tab signs out).
  expect(await page.evaluate(async () => (await fetch('/api/auth/logout', { method: 'POST' })).status)).toBeLessThan(300)
  let downloads = 0
  page.on('download', () => downloads++)
  await page.getByRole('button', { name: 'Descargar un ZIP' }).click()
  await expect(page).toHaveURL(/\/login\?next=/)
  await expect(page.getByRole('heading', { name: 'Hola de nuevo' })).toBeVisible()
  await expect(page.getByText('"unauthorized"')).toHaveCount(0)
  expect(downloads).toBe(0)
  await context.close()
  // The refused question is how the app learns the session ended.
  const ended = /status of 401/
  consoleErrors.splice(0, consoleErrors.length, ...consoleErrors.filter((e) => !ended.test(e)))
})
