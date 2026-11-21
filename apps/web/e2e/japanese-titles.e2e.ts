import type { Locator, Page } from '@playwright/test'
import { expect, openNewWorkspace, test } from './helpers'

const TITLE = '来週の打ち合わせまでに見積書を三社から取り寄せて比較する'
/** Its phrases, as BudouX (and Chromium) tell them apart. */
const PHRASES = ['来週の', '打ち合わせまでに', '見積書を', '三社から', '取り寄せて', '比較する']
const BOUNDARIES = PHRASES.slice(0, -1).map((_, i) => PHRASES.slice(0, i + 1).join('').length)
const DATED = '会議 2026年11月21日の議事録を共有する'
const LONG = 'インターナショナライゼーションコンサルティングサービスの見積もり'

/** Where each line of a text starts, counted in characters: the lines it is broken into on screen. */
const lineStarts = (element: Locator) =>
  element.evaluate((root) => {
    const starts: number[] = []
    let offset = 0
    let top: number | null = null
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? ''
      for (let i = 0; i < text.length; i++) {
        const range = document.createRange()
        range.setStart(node, i)
        range.setEnd(node, i + 1)
        const rect = range.getBoundingClientRect()
        if (top !== null && rect.top > top + rect.height / 2) starts.push(offset + i)
        top = rect.top
      }
      offset += text.length
    }
    return starts
  })

/** The same text, plain, laid out in the same place: how the browser alone would break it. */
const plainStarts = async (page: Page, element: Locator) => {
  const handle = await element.evaluateHandle((el) => {
    const copy = document.createElement('span')
    copy.textContent = el.textContent
    copy.dataset.plainCopy = ''
    el.after(copy)
    el.setAttribute('hidden', '')
    return copy
  })
  const starts = await lineStarts(page.locator('[data-plain-copy]'))
  await handle.evaluate((copy) => {
    copy.previousElementSibling?.removeAttribute('hidden')
    copy.remove()
  })
  return starts
}

// Japanese has no spaces: a title breaks between its phrases, never inside a word. Chromium tells
// them apart itself; Firefox and Safari are told by BudouX, loaded only for them.
test('Japanese titles break between their phrases in every browser', async ({ page, browserName }, testInfo) => {
  const workspaceId = await openNewWorkspace(page, '日本語 E2E')
  await page.request.patch('/api/account', { data: { locale: 'ja' } })
  try {
    const project = (await (await page.request.post(`/api/workspaces/${workspaceId}/projects`, { data: { name: '引っ越しの準備と手続きをまとめたプロジェクト' } })).json()) as { id: string }
    const board = (await (await page.request.post(`/api/projects/${project.id}/boards`, { data: { name: 'タスク' } })).json()) as { id: string }
    const columns = ((await (await page.request.get(`/api/boards/${board.id}`)).json()) as { columns: Array<{ id: string }> }).columns
    for (const title of [TITLE, DATED, LONG]) await page.request.post(`/api/columns/${columns[0]!.id}/cards`, { data: { title } })
    const doc = (await (await page.request.post(`/api/projects/${project.id}/pages`, { data: { title: TITLE, parentId: null } })).json()) as { id: string }

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/w/${workspaceId}/b/${board.id}`)
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
    const title = page.locator('.orq-phrases', { hasText: TITLE })
    await expect(title).toBeVisible()
    const native = await page.evaluate(() => CSS.supports('word-break', 'auto-phrase'))
    expect(native).toBe(browserName === 'chromium')
    if (native) await expect(title.locator('wbr')).toHaveCount(0)
    else await expect(title.locator('wbr')).toHaveCount(PHRASES.length - 1)

    // At every width, each line starts where a phrase does; where only BudouX tells them apart, the
    // browser alone breaks inside a word at one of them at least (or this proves nothing).
    let plainMisses = 0
    for (const width of [390, 360, 330, 300]) {
      await page.setViewportSize({ width, height: 844 })
      const starts = await lineStarts(title)
      expect(starts.length, `${width}px`).toBeGreaterThan(0)
      for (const start of starts) expect(BOUNDARIES, `${width}px: a line starts at «${TITLE.slice(start)}»`).toContain(start)
      if (!native) plainMisses += (await plainStarts(page, title)).filter((start) => !BOUNDARIES.includes(start)).length
    }
    if (!native) expect(plainMisses).toBeGreaterThan(0)

    // A year stays whole; a word too long for its line still breaks, and nothing runs out of its card.
    const dated = page.locator('.orq-phrases', { hasText: DATED })
    const year = DATED.indexOf('2026')
    for (const start of await lineStarts(dated)) expect(start <= year || start >= year + 4, `«${DATED.slice(start)}»`).toBe(true)
    for (const text of [TITLE, DATED, LONG]) {
      const card = page.locator('.orq-phrases', { hasText: text }).locator('xpath=ancestor::p[1]')
      expect(await card.evaluate((p) => p.scrollWidth <= p.clientWidth), text).toBe(true)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: testInfo.outputPath('1-tablero.png'), animations: 'disabled' })

    // The project's name on its page breaks the same way.
    await page.goto(`/w/${workspaceId}/p/${project.id}`)
    const name = page.getByRole('heading', { level: 1 }).locator('.orq-phrases')
    await expect(name).toBeVisible()
    if (!native) await expect(name.locator('wbr')).not.toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('2-proyecto.png'), animations: 'disabled' })

    // A page's title, which is edited in place: drawn broken between phrases until it is edited.
    await page.goto(`/w/${workspaceId}/d/${doc.id}`)
    const field = page.getByRole('textbox', { name: 'ページのタイトル' })
    await expect(field).toHaveValue(TITLE)
    const drawn = page.locator('.orq-phrases[aria-hidden="true"]', { hasText: TITLE })
    if (native) await expect(drawn).toHaveCount(0)
    else {
      await expect(drawn.locator('wbr')).toHaveCount(PHRASES.length - 1)
      for (const start of await lineStarts(drawn)) expect(BOUNDARIES).toContain(start)
      await expect(field).toHaveCSS('opacity', '0')
    }
    await page.screenshot({ path: testInfo.outputPath('3-pagina.png'), animations: 'disabled' })
    // Clicked, it is the field itself that is edited.
    await field.click()
    await expect(field).toBeFocused()
    await expect(drawn).toHaveCount(0)
    await expect(field).toHaveCSS('opacity', '1')
    await field.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length))
    await page.keyboard.type('！')
    await expect(field).toHaveValue(`${TITLE}！`)
    await page.keyboard.press('Tab')
    if (!native) await expect(page.locator('.orq-phrases[aria-hidden="true"]', { hasText: `${TITLE}！` })).toBeVisible()
  } finally {
    // The other tests share this copy and expect it in Spanish.
    await page.request.patch('/api/account', { data: { locale: 'es' } })
  }
})
