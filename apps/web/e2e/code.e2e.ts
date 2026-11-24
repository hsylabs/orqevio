import type { Page } from '@playwright/test'
import { createProject, expect, openNewWorkspace, test } from './helpers'

// A code block, as in Notion: its language on a bar above it, chosen from a list with a search box,
// its colours, and a button that copies it. What it saves is still a Markdown fence, as GitHub reads it.

/** What the page copies, in every engine: WebKit doesn't let a test read the clipboard. */
async function recordCopies(page: Page) {
  await page.addInitScript(() => {
    const copied: string[] = []
    Object.assign(window, { copied })
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (text: string) => void copied.push(text) })
  })
  return () => page.evaluate(() => (window as unknown as { copied: string[] }).copied)
}

async function openPage(page: Page, name: string, content: string) {
  const workspace = (await (await page.request.post('/api/workspaces', { data: { name } })).json()) as { id: string }
  const project = (await (await page.request.post(`/api/workspaces/${workspace.id}/projects`, { data: { name: 'Notas' } })).json()) as { id: string }
  const created = await page.request.post(`/api/projects/${project.id}/pages`, { data: { title: 'Código', content } })
  expect(created.status(), await created.text()).toBe(201)
  const pageId = ((await created.json()) as { id: string }).id
  await page.goto(`/w/${workspace.id}/d/${pageId}`)
  const editor = page.getByRole('textbox', { name: 'Contenido de la página' })
  await expect(editor).toBeVisible()
  const saved = async () => ((await (await page.request.get(`/api/pages/${pageId}`)).json()) as { content: string }).content.trim()
  return { editor, saved }
}

test('choose the language of a code block, see its colours and copy it', async ({ page }) => {
  const copied = await recordCopies(page)
  const { editor, saved } = await openPage(page, 'Código E2E', 'Notas\n\n```ts\nconst a = 1\n```\n\n```\nResume el texto en tres puntos.\n```')
  const blocks = editor.locator('.orq-code')

  // Its colours, which come apart from the editor, and its language by name.
  await expect(blocks.first().locator('.hljs-keyword')).toHaveText('const')
  const language = page.getByRole('button', { name: 'Lenguaje: TypeScript' })
  await expect(language).toBeVisible()
  await expect(language).toHaveAttribute('aria-expanded', 'false')
  // A block without a language, a prompt, takes no colours.
  await expect(blocks.nth(1).locator('[class^="hljs-"]')).toHaveCount(0)

  // The list: a search box, the language ticked, and the one chosen with Enter.
  await language.click()
  const list = page.getByRole('dialog', { name: 'Lenguaje del bloque de código' })
  await expect(list.getByRole('combobox')).toBeFocused()
  await expect(language).toHaveAttribute('aria-expanded', 'true')
  await expect(list.getByRole('option', { name: 'TypeScript' })).toHaveAttribute('aria-current', 'true')
  await page.keyboard.type('pyth')
  await expect(list.getByRole('option', { name: 'Python' })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(list).toBeHidden()
  await expect.poll(saved).toBe('Notas\n\n```python\nconst a = 1\n```\n\n```\nResume el texto en tres puntos.\n```')
  const python = page.getByRole('button', { name: 'Lenguaje: Python' })
  await expect(python).toBeVisible()
  // The cursor was in «Notas»: it goes to the end of the block's code. Each change is undone on its own.
  await expect(editor).toBeFocused()
  await page.keyboard.type('!')
  await expect.poll(saved).toBe('Notas\n\n```python\nconst a = 1!\n```\n\n```\nResume el texto en tres puntos.\n```')
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(saved).toBe('Notas\n\n```python\nconst a = 1\n```\n\n```\nResume el texto en tres puntos.\n```')
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(saved).toBe('Notas\n\n```ts\nconst a = 1\n```\n\n```\nResume el texto en tres puntos.\n```')

  // Its language again closes the list, as a menu's button does.
  await language.click()
  await expect(list).toBeVisible()
  await language.click()
  await expect(list).toBeHidden()
  await expect(language).toHaveAttribute('aria-expanded', 'false')
  // A press elsewhere closes it and keeps the focus it gives.
  await language.click()
  await expect(list).toBeVisible()
  const title = page.getByRole('textbox', { name: 'Título de la página' })
  await title.click()
  await expect(list).toBeHidden()
  await expect(title).toBeFocused()
  await page.waitForTimeout(100)
  await expect(title).toBeFocused()

  // The prompt's button copies it, as it is; pressed with the list of another block open, it
  // closes the list and leaves the focus in the editor, as it takes none.
  await language.click()
  await expect(list).toBeVisible()
  await blocks.nth(1).hover()
  await blocks.nth(1).getByRole('button', { name: 'Copiar código' }).click()
  await expect(list).toBeHidden()
  await expect.poll(copied).toEqual(['Resume el texto en tres puntos.'])
  await expect(page.getByText('Código copiado')).toBeVisible()
  await expect(editor).toBeFocused()

  // A language the list doesn't know is used as it is written.
  await blocks.nth(1).getByRole('button', { name: 'Lenguaje: Texto plano' }).click()
  await page.keyboard.type('mermaid')
  await list.getByRole('option', { name: 'Usar «mermaid»' }).click()
  await expect.poll(saved).toBe('Notas\n\n```ts\nconst a = 1\n```\n\n```mermaid\nResume el texto en tres puntos.\n```')
  await expect(blocks.nth(1).getByRole('button', { name: 'Lenguaje: mermaid' })).toBeVisible()
})

test('from the keyboard: the block menu has its language and copies its code', async ({ page }) => {
  const copied = await recordCopies(page)
  const { editor, saved } = await openPage(page, 'Código teclado E2E', 'Antes\n\n```js\nlet uno = 1\n```')
  const code = editor.getByText('let uno = 1')
  await expect(editor.locator('.hljs-keyword')).toHaveText('let')
  // At the end of its line, with a click there: Chromium without a window doesn't tell the editor of a native End.
  const box = (await code.boundingBox())!
  await code.click({ position: { x: box.width - 1, y: box.height / 2 } })
  await page.keyboard.press('ControlOrMeta+/')
  await page.getByRole('menuitem', { name: 'Lenguaje…' }).click()
  const list = page.getByRole('dialog', { name: 'Lenguaje del bloque de código' })
  await expect(list.getByRole('combobox')).toBeFocused()
  await page.keyboard.type('sh')
  await expect(list.getByRole('option', { name: 'Bash' })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect.poll(saved).toBe('Antes\n\n```bash\nlet uno = 1\n```')
  // The cursor is back where it was, at the end of the line.
  await page.keyboard.type(';')
  await expect.poll(saved).toBe('Antes\n\n```bash\nlet uno = 1;\n```')

  // Escape closes the list and leaves the language as it was.
  await page.keyboard.press('ControlOrMeta+/')
  await page.getByRole('menuitem', { name: 'Lenguaje…' }).press('Enter')
  await expect(list).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(list).toBeHidden()
  await expect(editor).toBeFocused()

  await page.keyboard.press('ControlOrMeta+/')
  await page.getByRole('menuitem', { name: 'Copiar código' }).click()
  await expect.poll(copied).toEqual(['let uno = 1;'])
  await expect.poll(saved).toBe('Antes\n\n```bash\nlet uno = 1;\n```')
})

test('in a card: Escape closes only the list, and the code of a comment has its colours and its copy button', async ({ page }) => {
  const copied = await recordCopies(page)
  const workspaceId = await openNewWorkspace(page, 'Código comentario E2E')
  const boardId = await createProject(page, 'Notas')
  const columns = ((await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string }> }).columns
  const card = (await (await page.request.post(`/api/columns/${columns[0]!.id}/cards`, { data: { title: 'Script', description: '```js\nlet a = 1\n```' } })).json()) as { id: string }
  await page.request.post(`/api/cards/${card.id}/comments`, { data: { body: 'Ejecuta esto:\n\n```bash\necho "hola"\n```' } })
  await page.goto(`/w/${workspaceId}/b/${boardId}?card=${card.id}`)
  const description = page.getByRole('textbox', { name: 'Descripción de la tarjeta' })
  await description.getByRole('button', { name: 'Lenguaje: JavaScript' }).click()
  const list = page.getByRole('dialog', { name: 'Lenguaje del bloque de código' })
  await expect(list.getByRole('combobox')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(list).toBeHidden()
  await expect(description).toBeFocused()
  await expect(description).toBeVisible()

  const comment = page.locator('.orq-prose--note').filter({ hasText: 'Ejecuta esto' })
  await expect(comment.locator('.hljs-built_in, .hljs-string').first()).toBeVisible()
  await expect(comment.locator('.orq-code-lang')).toHaveText('Bash')
  await comment.locator('.orq-code').hover()
  await comment.getByRole('button', { name: 'Copiar código' }).click()
  await expect.poll(copied).toEqual(['echo "hola"'])
})

test.describe('on a phone', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

  test('the language and the copy button are there without a pointer', async ({ page }) => {
    const copied = await recordCopies(page)
    const { saved } = await openPage(page, 'Código móvil E2E', '```\nUn prompt\n```')
    const copy = page.getByRole('button', { name: 'Copiar código' })
    await expect(copy).toBeVisible()
    await copy.tap()
    await expect.poll(copied).toEqual(['Un prompt'])
    await page.getByRole('button', { name: 'Lenguaje: Texto plano' }).tap()
    await page.getByRole('option', { name: 'Markdown' }).tap()
    await expect.poll(saved).toBe('```markdown\nUn prompt\n```')
    await page.screenshot({ path: test.info().outputPath('phone.png') })
  })
})
