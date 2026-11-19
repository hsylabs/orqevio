import { addCard, createProject, expect, openNewWorkspace, test } from './helpers'

test('write a document that references a task', async ({ page }) => {
  await openNewWorkspace(page, 'Documentos E2E')
  await createProject(page, 'Producto')
  await addCard(page, 'Por hacer', 'Investigar a la competencia')

  await page.getByRole('button', { name: 'Nueva página en Producto' }).click({ force: true })
  await page.waitForURL(/\/d\//)
  await page.getByLabel('Título de la página').fill('Plan de producto')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/título 2')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Contexto')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Ver @Investigar')
  await expect(page.getByRole('option', { name: /Investigar a la competencia/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await page.keyboard.type('antes de decidir.')
  await expect(page.getByText('Guardado')).toBeVisible()

  // The reference created a link that both sides show.
  await expect(page.getByLabel('Tareas vinculadas').getByText('Investigar a la competencia')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { level: 2, name: 'Contexto' })).toBeVisible()
  await expect(page.locator('.orq-prose a[href^="/card/"]')).toHaveText('Investigar a la competencia')

  const pageId = page.url().split('/d/')[1]!
  const markdown = await page.evaluate(async (id) => (await (await fetch(`/api/pages/${id}`)).json()).content as string, pageId)
  expect(markdown).toMatch(/^## Contexto/m)
  expect(markdown).toMatch(/\[Investigar a la competencia\]\(\/card\/[0-9a-f-]{36}\)/)

  // Clicking the reference opens the card on its board.
  await page.locator('.orq-prose a[href^="/card/"]').click()
  await page.waitForURL(/\/b\/.+\?card=/)
  await expect(page.getByLabel('Título de la tarjeta')).toHaveValue('Investigar a la competencia')
  await expect(page.getByRole('link', { name: 'Plan de producto' })).toBeVisible()
})

// Agents write Markdown the editor can't show. Editing the page must keep it as it was.
test('editing a page keeps the Markdown the editor cannot show', async ({ page }) => {
  const workspaceId = await openNewWorkspace(page, 'Markdown E2E')
  const boardId = await createProject(page, 'Notas')
  const { projectId } = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { projectId: string }
  const created = await page.request.post(`/api/projects/${projectId}/pages`, { data: { title: 'Fiel' } })
  const pageId = ((await created.json()) as { id: string }).id
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const upload = await page.request.post(`/api/pages/${pageId}/attachments`, { headers: { 'Content-Type': 'image/png', 'X-File-Name': 'badge.png' }, data: pixel })
  const badge = ((await upload.json()) as { url: string }).url
  const markdown = [
    '#### Detalles',
    `[![build](${badge})](https://ci.example.com)`,
    '<details>\n<summary>Más</summary>\n\nDentro **negrita**\n\n</details>',
    'Pulsa <kbd>Ctrl</kbd>, AT&T y a < b',
    '\\# no es un título',
    'Final',
  ].join('\n\n')
  const saved = await page.request.patch(`/api/pages/${pageId}`, { data: { content: markdown, baseVersion: 1 } })
  expect(saved.status(), await saved.text()).toBe(200)

  await page.goto(`/w/${workspaceId}/d/${pageId}`)
  const editor = page.getByRole('textbox', { name: 'Contenido de la página' })
  await expect(editor.getByRole('heading', { level: 4, name: 'Detalles' })).toBeVisible()
  // HTML shows as its source.
  await expect(editor.locator('pre[data-raw-html]').first()).toHaveText('<details>\n<summary>Más</summary>')
  await expect(editor.locator('code[data-raw-html]').first()).toHaveText('<kbd>')
  await editor.getByText('Final').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' editado')
  await expect(page.getByText('Guardado')).toBeVisible()
  const content = async () => ((await (await page.request.get(`/api/pages/${pageId}`)).json()) as { content: string }).content
  await expect.poll(content).toBe(`${markdown} editado`)
})

// More Markdown the editor can't show, or used to write back differently: front matter, a code
// block showing a fence, tasks under a numbered step, an address with spaces and footnotes. Opened
// and edited in the editor, the page keeps all of it as it was.
test('editing a page keeps front matter, fences in code, tasks in numbered steps, addresses with spaces and footnotes', async ({ page }) => {
  // Made through the API before the browser opens anything: nothing is on its way when it does.
  const workspace = (await (await page.request.post('/api/workspaces', { data: { name: 'Markdown fiel E2E' } })).json()) as { id: string }
  const project = (await (await page.request.post(`/api/workspaces/${workspace.id}/projects`, { data: { name: 'Notas' } })).json()) as { id: string }
  const markdown = [
    '---\ntitle: Guía\ntags: [a, b]\n---',
    'Así se escribe un bloque:',
    '````md\n```js\nconst a = 1\n```\n````',
    '1. Preparar\n   - [ ] revisar\n   - [x] enviar\n2. Publicar',
    'Ver [la guía](</docs/guía de estilo>) y una nota[^1].',
    '[^1]: La nota, con [enlace](https://orqevio.com).',
    'Final',
  ].join('\n\n')
  const created = await page.request.post(`/api/projects/${project.id}/pages`, { data: { title: 'Fiel', content: markdown } })
  expect(created.status(), await created.text()).toBe(201)
  const pageId = ((await created.json()) as { id: string }).id

  await page.goto(`/w/${workspace.id}/d/${pageId}`)
  const editor = page.getByRole('textbox', { name: 'Contenido de la página' })
  // Front matter and the footnote show as their source; the rest as usual.
  await expect(editor.locator('pre[data-raw-markdown]').first()).toHaveText('---\ntitle: Guía\ntags: [a, b]\n---')
  await expect(editor.locator('code[data-raw-markdown]')).toHaveText('[^1]')
  await expect(editor.locator('pre code').first()).toContainText('```js')
  await expect(editor.getByRole('link', { name: 'la guía' })).toBeVisible()
  await expect(editor.getByRole('checkbox')).toHaveCount(2)

  await editor.getByText('Final').click()
  await page.keyboard.press('Control+End')
  // The editor takes the new caret a moment after the browser moves it.
  await page.waitForFunction(() => {
    type Tiptap = { state: { selection: { to: number }; doc: { content: { size: number } } } }
    const tiptap = (document.querySelector('.orq-prose') as (HTMLElement & { editor?: Tiptap }) | null)?.editor
    return tiptap !== undefined && tiptap.state.selection.to === tiptap.state.doc.content.size - 1
  })
  await page.keyboard.type(' editado')
  await expect(page.getByText('Guardado')).toBeVisible()
  const content = async () => ((await (await page.request.get(`/api/pages/${pageId}`)).json()) as { content: string }).content
  await expect.poll(content).toBe(`${markdown} editado`)
})
