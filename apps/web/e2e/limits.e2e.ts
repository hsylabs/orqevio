import { expect, test } from './helpers'

// SQLite in a Cloudflare Durable Object takes at most 100 parameters a query. These cases failed
// there while working on Node; the suite also runs against the Cloudflare package.
//
// Each test makes its data through the API before the browser opens anything: with the workspace
// open, every change would refresh it live, and opening another address in the middle cuts those
// requests short, which WebKit reports as errors («… due to access control checks»).

/** A workspace of its own, not opened in the browser yet. */
async function workspace(page: import('@playwright/test').Page, name: string) {
  const res = await page.request.post('/api/workspaces', { data: { name } })
  expect(res.status(), await res.text()).toBe(201)
  return ((await res.json()) as { id: string }).id
}

async function board(page: import('@playwright/test').Page, workspaceId: string, columns?: string[]) {
  const project = (await (await page.request.post(`/api/workspaces/${workspaceId}/projects`, { data: { name: 'Sprint' } })).json()) as { id: string }
  const created = await page.request.post(`/api/projects/${project.id}/boards`, { data: { name: 'Tablero', ...(columns ? { columns } : {}) } })
  expect(created.status(), await created.text()).toBe(201)
  const { id } = (await created.json()) as { id: string }
  const detail = (await (await page.request.get(`/api/boards/${id}`)).json()) as { columns: Array<{ id: string; name: string }> }
  return { projectId: project.id, boardId: id, columns: detail.columns }
}

test('a page that mentions 30 cards saves from the editor, and each card links it', async ({ page }) => {
  const workspaceId = await workspace(page, 'Menciones E2E')
  const { projectId, columns } = await board(page, workspaceId)
  const cards: string[] = []
  for (let i = 0; i < 30; i++) {
    const card = await page.request.post(`/api/columns/${columns[0]!.id}/cards`, { data: { title: `Tarea ${i + 1}` } })
    cards.push(((await card.json()) as { id: string }).id)
  }
  const content = cards.map((id, i) => `- [Tarea ${i + 1}](/card/${id})`).join('\n')
  const created = await page.request.post(`/api/projects/${projectId}/pages`, { data: { title: 'Seguimiento', content } })
  expect(created.status(), await created.text()).toBe(201)
  const { id } = (await created.json()) as { id: string }

  // Edited in the editor, the page saves with all its mentions.
  await page.goto(`/w/${workspaceId}/d/${id}`)
  await expect(page.locator('.orq-prose a[href^="/card/"]')).toHaveCount(30)
  await page.locator('.orq-prose').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Revisado')
  await expect(page.getByText('Guardado')).toBeVisible()
  const saved = (await (await page.request.get(`/api/pages/${id}`)).json()) as { content: string }
  expect(saved.content).toContain('Revisado')
  for (const card of [cards[0]!, cards[29]!]) {
    const detail = (await (await page.request.get(`/api/cards/${card}`)).json()) as { pages: Array<{ id: string }> }
    expect(detail.pages.map((p) => p.id)).toEqual([id])
  }
})

test('a board created with its 20 columns shows them all', async ({ page }) => {
  const workspaceId = await workspace(page, 'Columnas E2E')
  const names = Array.from({ length: 20 }, (_, i) => `Columna ${i + 1}`)
  const { boardId } = await board(page, workspaceId, names)
  await page.goto(`/w/${workspaceId}/b/${boardId}`)
  await expect(page.getByRole('region', { name: 'Columna Columna 20' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Añadir columna' })).toHaveCount(0)
})

test('a card with 101 checklists opens with all of them', async ({ page }) => {
  const workspaceId = await workspace(page, 'Listas E2E')
  const { boardId, columns } = await board(page, workspaceId)
  const card = ((await (await page.request.post(`/api/columns/${columns[0]!.id}/cards`, { data: { title: 'Muchas listas' } })).json()) as { id: string }).id
  for (let i = 0; i < 101; i++) {
    expect((await page.request.post(`/api/cards/${card}/checklists`, { data: { title: `Lista ${i + 1}` } })).status()).toBe(201)
  }
  await page.goto(`/w/${workspaceId}/b/${boardId}?card=${card}`)
  const sheet = page.getByRole('dialog', { name: 'Muchas listas' })
  await expect(sheet.getByText('Lista 101', { exact: true })).toBeVisible()
})
