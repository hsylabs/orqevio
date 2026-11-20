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

// Revoked and expired accesses don't count: not as accesses elsewhere, nor as an agent connected.
// And the activity of one access stays on its workspace's page.
test('only accesses that still work count elsewhere and at home, and the activity filter stays in its workspace', async ({ page }, testInfo) => {
  const workspace = async (name: string) => ((await (await page.request.post('/api/workspaces', { data: { name } })).json()) as { id: string }).id
  const token = async (name: string, workspaceId: string) => {
    const res = await page.request.post('/api/tokens', { data: { name, workspaceId, scopes: ['tasks:read'], expiresInDays: 30 } })
    expect(res.status()).toBe(201)
    return ((await res.json()) as { id: string }).id
  }
  // Everything before the app opens: its lists then load once, with all of it.
  const first = await workspace('Activo uno')
  const second = await workspace('Revocado dos')
  await token('Asistente uno', first)
  const old = await token('Asistente viejo', second)
  expect((await page.request.delete(`/api/tokens/${old}`)).ok()).toBe(true)

  await page.goto(`/w/${second}`)
  // Home: an access revoked is no agent connected.
  const steps = page.getByRole('region', { name: 'Primeros pasos' })
  await expect(steps.getByText('Conecta un agente')).toBeVisible()
  await expect(steps.getByText('Conecta un agente')).not.toHaveClass(/line-through/)
  await page.screenshot({ path: testInfo.outputPath('3-revocado-no-cuenta-como-conectado.png'), animations: 'disabled' })

  // In the first workspace, the second's revoked access is not "an access elsewhere".
  await page.getByRole('button', { name: /^Revocado dos/ }).click()
  await page.getByRole('menuitem', { name: /Activo uno/ }).click()
  await page.waitForURL(`**/w/${first}`)
  await page.getByRole('navigation').getByRole('link', { name: 'Agentes' }).click()
  await expect(page.getByRole('heading', { name: 'Asistente uno' })).toBeVisible()
  // (Other tests' workspaces may be listed; this one, with only a revoked access, is not.)
  await expect(page.getByRole('link', { name: /^Revocado dos/ })).toHaveCount(0)

  // One access's activity, then another workspace: there, all of its agents' activity.
  await page.getByRole('button', { name: 'Ver su actividad' }).click()
  await expect(page.getByRole('heading', { name: 'Actividad de «Asistente uno»' })).toBeVisible()
  await page.getByRole('button', { name: /^Activo uno/ }).click()
  await page.getByRole('menuitem', { name: /Revocado dos/ }).click()
  await page.waitForURL(`**/w/${second}`)
  await page.getByRole('navigation').getByRole('link', { name: 'Agentes' }).click()
  await page.waitForURL(`**/w/${second}/agents`)
  await expect(page.getByRole('heading', { name: 'Actividad de los agentes' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Actividad de «Asistente uno»' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('4-actividad-de-todo-el-espacio.png'), animations: 'disabled' })
})
