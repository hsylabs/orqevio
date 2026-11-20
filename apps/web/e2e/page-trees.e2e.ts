import type { APIRequestContext } from '@playwright/test'
import { createPageChain, createProject, expect, openNewWorkspace, test } from './helpers'

const LEVELS = 50
const chain = (request: APIRequestContext, projectId: string) => createPageChain(request, projectId, LEVELS)

async function expectGone(request: APIRequestContext, ids: string[]) {
  const statuses = await Promise.all(ids.map(async (id) => (await request.get(`/api/pages/${id}`)).status()))
  expect(statuses).toEqual(ids.map(() => 404))
}

// Deleting a page deletes its subpages, and deleting a project or a workspace deletes its pages.
// On Cloudflare, SQLite allows only a few levels of cascading deletes: deep trees must still go,
// to the trash and back.
test('deep page trees are deleted with their page, project or workspace', async ({ page }) => {
  const workspaceId = await openNewWorkspace(page, 'Árboles E2E')
  const boardId = await createProject(page, 'Profundo')
  const { projectId } = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { projectId: string }

  // A page with 49 levels under it, deleted in the app.
  const pages = await chain(page.request, projectId)
  // Opened from the sidebar, as a person would: loading the page anew here would cut short the
  // refetches the fifty new pages set off, and WebKit reports a request cut short as an error.
  await page.getByRole('navigation').getByRole('link').filter({ hasText: /^Nivel 1$/ }).click()
  await expect(page.getByLabel('Título de la página')).toHaveValue('Nivel 1')
  await page.getByRole('button', { name: 'Acciones de la página' }).click()
  await page.getByRole('menuitem', { name: 'Eliminar página' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar página' }).click()
  await expect(page.getByText('Página movida a la papelera')).toBeVisible()
  await expect(page).not.toHaveURL(new RegExp(pages[0]!))
  await expectGone(page.request, pages)

  // It waits in the trash, and comes back whole.
  await page.goto(`/w/${workspaceId}/trash`)
  const entry = page.getByRole('listitem', { name: 'Nivel 1' })
  await expect(entry).toContainText(`Página · Profundo · ${LEVELS - 1} páginas`)
  await entry.getByRole('button', { name: 'Restaurar «Nivel 1»' }).click()
  // It holds pages: what comes back is shown first, all of it ticked.
  const dialog = page.getByRole('dialog', { name: 'Restaurar «Nivel 1»' })
  await expect(dialog.getByRole('checkbox', { name: 'Incluir «Nivel 2»' })).toBeChecked()
  await dialog.getByRole('button', { name: 'Restaurar', exact: true }).click()
  await expect(page.getByText('Se ha restaurado «Nivel 1»')).toBeVisible()
  const back = await Promise.all(pages.map(async (id) => (await page.request.get(`/api/pages/${id}`)).status()))
  expect(back).toEqual(pages.map(() => 200))
  expect(((await (await page.request.get(`/api/pages/${pages.at(-1)}`)).json()) as { parentId: string }).parentId).toBe(pages.at(-2))

  // A project holding a deep tree.
  const other = await page.request.post(`/api/workspaces/${workspaceId}/projects`, { data: { name: 'Otro' } })
  expect(other.status(), await other.text()).toBe(201)
  const otherId = ((await other.json()) as { id: string }).id
  const inProject = await chain(page.request, otherId)
  expect((await page.request.delete(`/api/projects/${otherId}`)).status()).toBe(200)
  await expectGone(page.request, inProject)

  // A whole workspace holding one.
  const spare = await page.request.post('/api/workspaces', { data: { name: 'Espacio profundo' } })
  const spareId = ((await spare.json()) as { id: string }).id
  const project = await page.request.post(`/api/workspaces/${spareId}/projects`, { data: { name: 'Hondo' } })
  const inWorkspace = await chain(page.request, ((await project.json()) as { id: string }).id)
  expect((await page.request.delete(`/api/workspaces/${spareId}`)).status()).toBe(204)
  await expectGone(page.request, inWorkspace)
})
