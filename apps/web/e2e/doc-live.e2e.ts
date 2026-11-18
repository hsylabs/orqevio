import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from './helpers'

// What an agent or another session changes in an open page shows there at once; it is not this
// person's to undo, and a conflict with another tab of their own says so.

/**
 * A page made through the API before the browser opens anything, with an agent that may write in
 * it. With the workspace already open, every change would refresh it live, and opening the page
 * then would cut those requests short (WebKit reports that as an error).
 */
async function pageWithAgent(page: Page, content: string) {
  const workspace = (await (await page.request.post('/api/workspaces', { data: { name: 'Directo E2E' } })).json()) as { id: string }
  const project = (await (await page.request.post(`/api/workspaces/${workspace.id}/projects`, { data: { name: 'Notas' } })).json()) as { id: string }
  const created = await page.request.post(`/api/projects/${project.id}/pages`, { data: { title: 'Plan', content } })
  expect(created.status(), await created.text()).toBe(201)
  const { id } = (await created.json()) as { id: string }
  const token = await page.request.post('/api/tokens', { data: { name: 'Claude', workspaceId: workspace.id, scopes: ['docs:read', 'docs:write'], expiresInDays: null } })
  expect(token.status(), await token.text()).toBe(201)
  return { workspaceId: workspace.id, projectId: project.id, pageId: id, token: ((await token.json()) as { token: string }).token }
}

/**
 * Puts the caret at the end of the text, and waits for the editor to have it there. The browser
 * moves it at once, but the editor learns of it a moment later: keys sent straight away, faster
 * than anyone types, would still go where it was.
 */
async function caretAtEnd(page: Page) {
  await page.keyboard.press('Control+End')
  await page.waitForFunction(() => {
    type Tiptap = { state: { selection: { to: number }; doc: { content: { size: number } } } }
    const editor = (document.querySelector('.orq-prose') as (HTMLElement & { editor?: Tiptap }) | null)?.editor
    return editor !== undefined && editor.state.selection.to === editor.state.doc.content.size - 1
  })
}

/** Writes in the page as the agent would: the whole text, over the version it read. */
async function agentWrites(request: APIRequestContext, baseURL: string, token: string, pageId: string, change: (content: string) => string) {
  const auth = { Authorization: `Bearer ${token}` }
  const current = (await (await request.get(`${baseURL}/api/pages/${pageId}`, { headers: auth })).json()) as { content: string; version: number }
  const res = await request.patch(`${baseURL}/api/pages/${pageId}`, { headers: auth, data: { content: change(current.content), baseVersion: current.version } })
  expect(res.status(), await res.text()).toBe(200)
}

test('Ctrl+Z after a live change undoes only what was written since, and never the change that came in', async ({ page, request, baseURL }) => {
  const { workspaceId, pageId, token } = await pageWithAgent(page, 'Primer párrafo')
  await page.goto(`/w/${workspaceId}/d/${pageId}`)
  const prose = page.locator('.orq-prose')
  const paragraphs = () => prose.locator('p').allInnerTexts()
  const saved = async () => ((await (await page.request.get(`/api/pages/${pageId}`)).json()) as { content: string }).content
  await expect(prose).toHaveText('Primer párrafo')
  await prose.getByText('Primer párrafo').click()
  await caretAtEnd(page)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Escrito aquí')
  await expect(page.getByText('Guardado')).toBeVisible()

  // The agent adds a paragraph; the open page shows it.
  await agentWrites(request, baseURL!, token, pageId, (content) => `${content}\n\nPárrafo del agente`)
  await expect(prose).toContainText('Párrafo del agente')
  const afterAgent = ['Primer párrafo', 'Escrito aquí', 'Párrafo del agente']
  await expect.poll(paragraphs).toEqual(afterAgent)

  // Written after it, and undone: only that goes.
  await prose.getByText('Párrafo del agente').click()
  await caretAtEnd(page)
  await page.keyboard.type(' y más')
  await expect.poll(paragraphs).toEqual(['Primer párrafo', 'Escrito aquí', 'Párrafo del agente y más'])
  await page.keyboard.press('Control+z')
  await expect.poll(paragraphs).toEqual(afterAgent)

  // Nothing before the change that came in can be undone any more: the text stays as it is,
  // on screen and saved.
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(1500)
  expect(await paragraphs()).toEqual(afterAgent)
  await expect.poll(saved).toBe('Primer párrafo\n\nEscrito aquí\n\nPárrafo del agente')
})

test('an open page shows at once a new title or icon from an agent', async ({ page, request, baseURL }) => {
  const { workspaceId, pageId, token } = await pageWithAgent(page, 'Texto')
  await page.goto(`/w/${workspaceId}/d/${pageId}`)
  await expect(page.locator('.orq-prose')).toHaveText('Texto')

  // Renamed and given an icon by the agent: the text, and so its version, stays the same.
  const renamed = await request.patch(`${baseURL}/api/pages/${pageId}`, { headers: { Authorization: `Bearer ${token}` }, data: { title: 'Plan revisado', icon: '🚀' } })
  expect(renamed.status(), await renamed.text()).toBe(200)
  await expect(page.getByLabel('Título de la página')).toHaveValue('Plan revisado')
  await expect(page.getByText('🚀 Plan revisado')).toBeVisible()
})

test('an open page lists at once a subpage added in another session', async ({ page }) => {
  const { workspaceId, projectId, pageId } = await pageWithAgent(page, 'Texto')
  await page.goto(`/w/${workspaceId}/d/${pageId}`)
  await expect(page.locator('.orq-prose')).toHaveText('Texto')
  await expect(page.getByRole('heading', { name: 'Subpáginas' })).toHaveCount(0)
  const child = await page.request.post(`/api/projects/${projectId}/pages`, { data: { title: 'Anexo', parentId: pageId } })
  expect(child.status(), await child.text()).toBe(201)
  await expect(page.getByRole('heading', { name: 'Subpáginas' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Anexo/ })).toBeVisible()
})

test('a change from another tab of this person while writing is told as another session, not with their name', async ({ page }) => {
  const { workspaceId, pageId } = await pageWithAgent(page, 'Borrador')
  await page.goto(`/w/${workspaceId}/d/${pageId}`)
  const prose = page.locator('.orq-prose')
  await expect(prose).toHaveText('Borrador')
  await prose.click()
  await caretAtEnd(page)
  await page.keyboard.type(' aquí')

  // Saved from another tab while this one, still writing, has not saved yet.
  const current = (await (await page.request.get(`/api/pages/${pageId}`)).json()) as { version: number }
  const other = await page.request.patch(`/api/pages/${pageId}`, { data: { content: 'Borrador desde otra pestaña', baseVersion: current.version } })
  expect(other.status(), await other.text()).toBe(200)
  // Writing on, a key every 200 ms, keeps this tab's save waiting until the change has come in.
  const banner = page.getByRole('alert').filter({ hasText: 'ha modificado esta página mientras editabas' })
  for (let i = 0; i < 25 && !(await banner.isVisible()); i++) {
    await page.keyboard.type('.')
    await page.waitForTimeout(200)
  }
  await expect(banner).toContainText('Otra sesión ha modificado esta página mientras editabas.')
  await expect(banner).not.toContainText('Lucía Martín')
})
