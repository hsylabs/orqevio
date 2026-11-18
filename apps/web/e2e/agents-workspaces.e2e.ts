import { expect, openNewWorkspace, test } from './helpers'

// Each workspace's Agents page shows its own accesses, says where the others are, and an access
// past its date says it expired, not when it "expires".
test('the Agents page of a workspace shows its accesses, and an expired one says so', async ({ page }, testInfo) => {
  const first = await openNewWorkspace(page, 'Agentes uno')
  const second = ((await (await page.request.post('/api/workspaces', { data: { name: 'Agentes dos' } })).json()) as { id: string }).id
  const token = async (name: string, workspaceId: string) =>
    expect((await page.request.post('/api/tokens', { data: { name, workspaceId, scopes: ['tasks:read'], expiresInDays: 30 } })).status()).toBe(201)
  await token('Asistente uno', first)
  await token('Asistente dos', second)
  // The home page already cached the empty list of accesses.
  await page.reload()

  await page.getByRole('navigation').getByRole('link', { name: 'Agentes' }).click()
  const active = page.getByRole('heading', { name: 'Accesos activos' }).locator('..')
  await expect(active.getByRole('heading', { name: 'Asistente uno' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Asistente dos' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('1-solo-los-de-este-espacio.png'), animations: 'disabled' })

  // The other workspace's accesses are on its own page, a link away.
  await page.getByRole('link', { name: 'Agentes dos (1)' }).click()
  await page.waitForURL(`**/w/${second}/agents`)
  await expect(page.getByRole('heading', { name: 'Asistente dos' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Asistente uno' })).toHaveCount(0)

  // A month later both have expired: neither "unused for N days" nor a date it "expires" on.
  await page.clock.setFixedTime(new Date(Date.now() + 31 * 86_400_000))
  await page.reload()
  await page.getByText('1 revocado o caducado').click()
  const expired = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Asistente dos' }) })
  await expect(expired).toContainText('Caducó')
  await expect(expired).not.toContainText('Caduca')
  await expect(expired).not.toContainText('Sin uso desde hace')
  await expired.screenshot({ path: testInfo.outputPath('2-caducado.png'), animations: 'disabled' })
})
