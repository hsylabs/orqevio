import type { Page } from '@playwright/test'
import { addCard, createProject, expect, openNewWorkspace, test } from './helpers'

/**
 * Lets a test hold the card sheet's next save of the card until `release`, like a slow network
 * would. The route is set up once, before the card is open: setting one up while a request of
 * the page is on its way can leave that request hanging, and the sheet waiting for it.
 */
async function holdSaves(page: Page, cardId: string) {
  let next: { sent: () => void; gate: Promise<void> } | null = null
  await page.route(`**/api/cards/${cardId}`, async (route) => {
    const hold = next
    if (route.request().method() !== 'PATCH' || !hold) return route.fallback()
    next = null
    hold.sent()
    await hold.gate
    await route.fallback()
  })
  return function holdNextSave() {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let sent!: () => void
    const saving = new Promise<void>((resolve) => (sent = resolve))
    next = { sent, gate }
    return { saving, release: async () => release() }
  }
}

// With a card open, a change to its description made elsewhere (here, by an agent)
// must show up, and the sheet must never overwrite it without asking.
test("an open card shows an agent's description and asks before overwriting it", async ({ page, request, baseURL, consoleErrors }) => {
  const workspaceId = await openNewWorkspace(page, 'Fichas E2E')
  await createProject(page, 'Contratos')
  await addCard(page, 'Por hacer', 'Revisar contrato')
  const created = await page.request.post('/api/tokens', {
    data: { name: 'Claude', workspaceId, scopes: ['tasks:read', 'tasks:write'], expiresInDays: null },
  })
  expect(created.status(), await created.text()).toBe(201)
  const { token } = (await created.json()) as { token: string }

  const boardId = new URL(page.url()).pathname.split('/b/')[1]!
  const cardId = ((await (await page.request.get(`/api/boards/${boardId}`)).json()) as { cards: Array<{ id: string; title: string }> }).cards.find((c) => c.title === 'Revisar contrato')!.id
  const holdNextSave = await holdSaves(page, cardId)
  await page.getByRole('button', { name: 'Revisar contrato' }).click()
  const editor = page.getByRole('textbox', { name: 'Descripción de la tarjeta' })
  await expect(editor).toBeVisible()
  const card = async () => (await (await page.request.get(`/api/cards/${cardId}`)).json()) as { description: string; version: number }
  const asAgent = async (description: string) => {
    const res = await request.patch(`${baseURL}/api/cards/${cardId}`, { headers: { Authorization: `Bearer ${token}` }, data: { description } })
    expect(res.status(), await res.text()).toBe(200)
  }

  // Nothing typed here: the agent's text replaces the old one.
  await asAgent('Plazo: viernes')
  await expect(editor).toHaveText('Plazo: viernes')
  await expect(page.getByText('Claude ha actualizado la descripción')).toBeVisible()

  // Typing while the agent writes: the sheet's save is refused and it asks.
  const first = holdNextSave()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(' y firma')
  await first.saving
  await asAgent('Plazo: lunes')
  await first.release()
  const banner = page.getByRole('alert').filter({ hasText: 'ha modificado la descripción mientras editabas' })
  await expect(banner).toContainText('Claude')
  expect((await card()).description).toBe('Plazo: lunes')
  // Typing more doesn't save anything until a version is chosen.
  await page.keyboard.type('.')
  await page.waitForTimeout(1500)
  expect((await card()).description).toBe('Plazo: lunes')
  await banner.getByRole('button', { name: 'Mantener la mía' }).click()
  await expect(banner).toHaveCount(0)
  await expect.poll(async () => (await card()).description).toBe('Plazo: viernes y firma.')
  await expect(page.getByText('Guardado', { exact: true })).toBeVisible()

  // The same again, now loading the agent's version.
  const second = holdNextSave()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(' (borrador)')
  await second.saving
  await asAgent('Versión del agente')
  await second.release()
  await expect(banner).toBeVisible()
  await banner.getByRole('button', { name: 'Cargar su versión' }).click()
  await expect(banner).toHaveCount(0)
  await expect(editor).toHaveText('Versión del agente')
  await page.waitForTimeout(1500)
  const final = await card()
  expect(final.description).toBe('Versión del agente')

  // Closing the sheet saves nothing more, and reopening it shows the same text.
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Revisar contrato' }).click()
  await expect(editor).toHaveText('Versión del agente')
  expect(await card()).toEqual(final)

  // Typing while a save is on its way and closing the sheet: what came after is saved too.
  const third = holdNextSave()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(', revisada')
  await third.saving
  await page.keyboard.type(' y firmada')
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await third.release()
  await expect.poll(async () => (await card()).description).toBe('Versión del agente, revisada y firmada')

  // The two refused saves are expected; some browsers log every 4xx answer as an error.
  const expected = (e: string) => /status of 409 \(Conflict\)/.test(e)
  consoleErrors.splice(0, consoleErrors.length, ...consoleErrors.filter((e) => !expected(e)))
})
