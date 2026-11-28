import type { Page } from '@playwright/test'
import { expect, test } from './helpers'

// Emoji as Notion and GitHub put them: «Emoji» in the «/» menu, «:» and a name in the text, and a
// shortcode typed whole. The emoji itself goes in the Markdown.

async function openPage(page: Page, name: string, content: string) {
  const workspace = (await (await page.request.post('/api/workspaces', { data: { name } })).json()) as { id: string }
  const project = (await (await page.request.post(`/api/workspaces/${workspace.id}/projects`, { data: { name: 'Notas' } })).json()) as { id: string }
  const created = await page.request.post(`/api/projects/${project.id}/pages`, { data: { title: 'Plan', content } })
  expect(created.status(), await created.text()).toBe(201)
  const pageId = ((await created.json()) as { id: string }).id
  await page.goto(`/w/${workspace.id}/d/${pageId}`)
  const editor = page.getByRole('textbox', { name: 'Contenido de la página' })
  await expect(editor).toBeVisible()
  const saved = async () => ((await (await page.request.get(`/api/pages/${pageId}`)).json()) as { content: string }).content
  return { editor, saved }
}

/** At the end of the line with the text given. */
async function endOf(page: Page, editor: ReturnType<Page['getByRole']>, text: string) {
  await editor.getByText(text, { exact: true }).click()
  await page.keyboard.press('End')
}

const emojiMenu = (page: Page) => page.getByRole('listbox', { name: 'Insertar emoji' })

/** Once the menus have popped in, as they are seen. */
async function snap(page: Page, path: string) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
  await page.screenshot({ path })
}

test('«Emoji» in the «/» menu lists them, finds one by its name, and puts it in the text', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const { editor, saved } = await openPage(page, 'Emoji E2E', 'Uno')
  await endOf(page, editor, 'Uno')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/emoji')
  const slash = page.getByRole('listbox', { name: 'Insertar bloque' })
  await expect(slash.getByRole('option', { name: /Emoji/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('slash-preview')).toContainText('También puedes escribir : y su nombre')
  await snap(page, testInfo.outputPath('emoji-slash-preview.png'))
  await page.keyboard.press('Enter')

  // Before a name is typed, the first of the list.
  const menu = emojiMenu(page)
  await expect(menu).toBeVisible()
  await expect(slash).toBeHidden()
  await expect(menu.getByRole('option').first()).toContainText('😀')
  await expect(menu).toContainText('Emoji')
  await snap(page, testInfo.outputPath('emoji-browse.png'))

  // By its name in Spanish, with its shortcode beside it.
  await page.keyboard.type('cohete')
  const rocket = menu.getByRole('option').first()
  await expect(rocket).toContainText('Cohete')
  await expect(rocket).toContainText(':rocket:')
  await snap(page, testInfo.outputPath('emoji-search.png'))
  await page.keyboard.press('Enter')
  await expect(menu).toBeHidden()
  await expect(editor).toContainText('🚀')
  await expect.poll(saved).toMatch(/^Uno\n\n🚀\n*$/)
})

test('«:» and a name open the list in the text, and the last chosen come first next time', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const { editor, saved } = await openPage(page, 'Emoji en el texto E2E', 'Listo')
  await endOf(page, editor, 'Listo')
  await page.keyboard.type(' :fueg')
  const menu = emojiMenu(page)
  await expect(menu.getByRole('option').first()).toContainText('Fuego')
  await page.keyboard.press('Enter')
  await expect.poll(saved).toMatch(/^Listo 🔥\n*$/)

  // By its shortcode, in English as GitHub's, and with the pointer.
  await page.keyboard.type(' :tad')
  await menu.getByRole('option', { name: /Cañón de confeti/ }).click()
  await expect.poll(saved).toMatch(/^Listo 🔥 🎉\n*$/)

  // From the «/» menu now: the last ones chosen, the latest first.
  await page.keyboard.press('Enter')
  await page.keyboard.type('/emoji')
  await page.keyboard.press('Enter')
  await expect(menu).toContainText('Recientes')
  await expect(menu.getByRole('option').nth(0)).toContainText('🎉')
  await expect(menu.getByRole('option').nth(1)).toContainText('🔥')
  await snap(page, testInfo.outputPath('emoji-recent.png'))

  // Esc closes it, and the «:» stays.
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect.poll(saved).toMatch(/^Listo 🔥 🎉\n\n:\n*$/)
})

test('a shortcode typed whole turns into its emoji, and Backspace brings it back', async ({ page }) => {
  const { editor, saved } = await openPage(page, 'Códigos E2E', 'Hecho')
  await endOf(page, editor, 'Hecho')
  // The first «:» with a name loads the emoji.
  await page.keyboard.type(' :tad')
  await expect(emojiMenu(page)).toBeVisible()
  await page.keyboard.type('a:')
  await expect(emojiMenu(page)).toBeHidden()
  await expect.poll(saved).toMatch(/^Hecho 🎉\n*$/)
  await page.keyboard.type(' :+1:')
  await expect.poll(saved).toMatch(/^Hecho 🎉 👍\n*$/)
  await page.keyboard.press('Backspace')
  await expect.poll(saved).toMatch(/^Hecho 🎉 :\+1:\n*$/)
})

test('a «:» in the text opens nothing and leaves Enter and the arrows alone, and in code it is only a «:»', async ({ page }) => {
  const { editor, saved } = await openPage(page, 'Dos puntos E2E', 'Hora\n\n```ruby\nx = 1\n```')
  await endOf(page, editor, 'Hora')
  // As a time, as French writes it, and with one letter after it.
  await page.keyboard.type(': 10:30, remarque :')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Uno :a')
  await expect(emojiMenu(page)).toBeHidden()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.type('b')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Dos')
  await expect.poll(saved).toMatch(/^Hora: 10:30, remarque :\n\nUno :ba\n\nDos\n\n```ruby\nx = 1\n```\n*$/)

  // In code: no list, and a shortcode stays as typed.
  await editor.getByText('x = 1').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' :rocket')
  await expect(emojiMenu(page)).toBeHidden()
  await page.keyboard.type(':')
  await expect.poll(saved).toContain('x = 1 :rocket:')
})
