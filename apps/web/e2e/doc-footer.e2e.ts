import { createProject, expect, openNewWorkspace, test } from './helpers'

// The subpages and attachments under a page sit in the space the editor keeps below
// its text: they must take clicks, not the editor.
test("a page's subpages and attachments can be clicked", async ({ page }) => {
  await openNewWorkspace(page, 'Pie E2E')
  const boardId = await createProject(page, 'Manual')
  const board = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { projectId: string; workspaceId: string }
  const createPage = async (data: Record<string, unknown>) => {
    const res = await page.request.post(`/api/projects/${board.projectId}/pages`, { data })
    expect(res.status(), await res.text()).toBe(201)
    return ((await res.json()) as { id: string }).id
  }
  const parent = await createPage({ title: 'Guía', content: 'Una línea de texto.' })
  await createPage({ title: 'Instalación', parentId: parent })
  const attached = await page.request.post(`/api/pages/${parent}/attachments`, {
    headers: { 'Content-Type': 'text/plain', 'X-File-Name': encodeURIComponent('notas.txt') },
    data: Buffer.from('Notas de la guía'),
  })
  expect(attached.status(), await attached.text()).toBe(201)

  await page.goto(`/w/${board.workspaceId}/d/${parent}`)
  const footer = page.locator('footer').filter({ hasText: 'Subpáginas' })
  await expect(footer.getByRole('link', { name: /Instalación/ })).toBeVisible()

  // Each control is what a click at its centre lands on, not the editor above it.
  const controls = [
    footer.getByRole('link', { name: /Instalación/ }),
    footer.getByRole('link', { name: 'notas.txt', exact: true }),
    footer.getByRole('link', { name: 'Descargar notas.txt' }),
    footer.getByRole('button', { name: 'Eliminar notas.txt' }),
    footer.getByRole('button', { name: 'Adjuntar archivo' }),
  ]
  for (const control of controls) {
    await control.scrollIntoViewIfNeeded()
    const hit = await control.evaluate((el) => {
      const box = el.getBoundingClientRect()
      const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      return target && el.contains(target) ? 'itself' : (target?.className.toString() ?? 'nothing')
    })
    expect(hit, await control.textContent()).toBe('itself')
  }

  // And real clicks do what they say.
  await footer.getByRole('button', { name: 'Eliminar notas.txt' }).click()
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click()
  const chooser = page.waitForEvent('filechooser', { timeout: 5000 })
  await footer.getByRole('button', { name: 'Adjuntar archivo' }).click()
  await (await chooser).setFiles([])
  const opened = page.waitForEvent('popup', { timeout: 5000 })
  await footer.getByRole('link', { name: 'notas.txt', exact: true }).click()
  await (await opened).close()
  await footer.getByRole('link', { name: /Instalación/ }).click()
  await page.waitForURL(/\/d\//)
  await expect(page.getByLabel('Título de la página')).toHaveValue('Instalación')
})
