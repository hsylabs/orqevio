import { readFile } from 'node:fs/promises'
import { expect, openNewWorkspace, test } from './helpers'

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
