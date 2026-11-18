import { readFile } from 'node:fs/promises'
import { ACCESS_KEY_FILE, createPageChain, expect, openNewWorkspace, test } from './helpers'

// Runs last, in a project of its own (see playwright.config.ts): it deletes the whole copy.
test('uninstall the copy from Settings: everything goes, and only the way to remove the copy is left', async ({ page }) => {
  const accessKey = (await readFile(ACCESS_KEY_FILE, 'utf8')).trim()
  const workspaceId = await openNewWorkspace(page, 'Desinstalar E2E')
  // A deep tree of pages goes too: on Cloudflare, SQLite allows only a few levels of cascading deletes.
  const project = await page.request.post(`/api/workspaces/${workspaceId}/projects`, { data: { name: 'Hondo' } })
  await createPageChain(page.request, ((await project.json()) as { id: string }).id, 50)
  await page.getByRole('button', { name: /Lucía Martín/ }).click()
  await page.getByRole('menuitem', { name: 'Ajustes' }).click()
  await page.getByRole('button', { name: 'Desinstalar Orqevio…' }).click()

  const dialog = page.getByRole('dialog', { name: 'Desinstalar Orqevio' })
  await expect(dialog.getByText('Todos los adjuntos.')).toBeVisible()
  const confirm = dialog.getByRole('button', { name: 'Desinstalar para siempre' })
  await dialog.getByLabel('Clave de acceso').fill(accessKey)
  // What becomes of the backups is asked each time, with nothing chosen beforehand.
  const backups = dialog.getByRole('group', { name: 'Sus copias de seguridad' })
  await expect(backups.getByRole('radio', { checked: true })).toHaveCount(0)
  // The name to type is the copy's: the Worker's on Cloudflare, the address's host elsewhere.
  const nameLabel = dialog.locator('label', { hasText: 'para confirmar' })
  const name = /«(.+)»/.exec(await nameLabel.innerText())![1]!
  const nameField = dialog.getByLabel(await nameLabel.innerText())
  await nameField.fill(`${name}x`)
  await expect(confirm).toBeDisabled()
  await nameField.fill(name)
  await expect(confirm).toBeDisabled()
  await backups.getByRole('radio', { name: /Conservarlas/ }).check()
  await confirm.click()

  await expect(page.getByRole('heading', { name: 'Orqevio se ha desinstalado' })).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
  // The backups were kept, apart from the data: the page says where.
  await expect(page.getByText('Sus copias de seguridad se han conservado')).toBeVisible()
  // The copy stays that way, refuses everything else, and still answers its health check.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Orqevio se ha desinstalado' })).toBeVisible()
  for (const path of ['/api/auth/me', '/api/workspaces', '/.well-known/oauth-authorization-server']) {
    expect((await page.request.get(path)).status(), path).toBe(410)
  }
  const login = await page.request.post('/api/auth/login', { data: { accessKey } })
  expect(login.status()).toBe(410)
  expect((await page.request.get('/healthz')).status()).toBe(200)
})
