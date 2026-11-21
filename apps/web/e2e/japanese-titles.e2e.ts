import type { Locator } from '@playwright/test'
import { expect, openNewWorkspace, test } from './helpers'

const TITLE = '来週の打ち合わせまでに見積書を三社から取り寄せて比較する'
/** Its phrases, as BudouX (and Chromium) tell them apart. */
const PHRASES = ['来週の', '打ち合わせまでに', '見積書を', '三社から', '取り寄せて', '比較する']

/** Where each line of a title starts, counted in characters: the lines it is broken into on screen. */
const lineStarts = (title: Locator) =>
  title.evaluate((element) => {
    const starts: number[] = []
    let offset = 0
    let top: number | null = null
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
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

// Japanese has no spaces: a title breaks between its phrases, never inside a word. Chromium tells
// them apart itself; Firefox and Safari are told by BudouX, loaded only for them.
test('a Japanese title breaks between its phrases in every browser', async ({ page, browserName }, testInfo) => {
  const workspaceId = await openNewWorkspace(page, '日本語 E2E')
  await page.request.patch('/api/account', { data: { locale: 'ja' } })
  try {
    const project = (await (await page.request.post(`/api/workspaces/${workspaceId}/projects`, { data: { name: '引っ越しの準備と手続きをまとめたプロジェクト' } })).json()) as { id: string }
    const board = (await (await page.request.post(`/api/projects/${project.id}/boards`, { data: { name: 'タスク' } })).json()) as { id: string }
    const columns = ((await (await page.request.get(`/api/boards/${board.id}`)).json()) as { columns: Array<{ id: string }> }).columns
    await page.request.post(`/api/columns/${columns[0]!.id}/cards`, { data: { title: TITLE } })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/w/${workspaceId}/b/${board.id}`)
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
    const title = page.locator('.orq-phrases', { hasText: TITLE })
    await expect(title).toBeVisible()

    const native = await page.evaluate(() => CSS.supports('word-break', 'auto-phrase'))
    expect(native).toBe(browserName === 'chromium')
    if (native) await expect(title.locator('wbr')).toHaveCount(0)
    else await expect(title.locator('wbr')).toHaveCount(PHRASES.length - 1)

    // It takes more than one line, and each one starts where a phrase does.
    const boundaries = PHRASES.slice(0, -1).map((_, i) => PHRASES.slice(0, i + 1).join('').length)
    const starts = await lineStarts(title)
    expect(starts.length).toBeGreaterThan(0)
    for (const start of starts) expect(boundaries, `a line starts at ${start}: «${TITLE.slice(start)}»`).toContain(start)
    // And nothing runs out of the card.
    expect(await title.evaluate((el) => el.closest('p')!.scrollWidth <= el.closest('p')!.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('1-tablero.png') })

    // The project's name on its page breaks the same way.
    await page.goto(`/w/${workspaceId}/p/${project.id}`)
    const name = page.getByRole('heading', { level: 1 }).locator('.orq-phrases')
    await expect(name).toBeVisible()
    if (!native) await expect(name.locator('wbr')).not.toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('2-proyecto.png') })
  } finally {
    // The other tests share this copy and expect it in Spanish.
    await page.request.patch('/api/account', { data: { locale: 'es' } })
  }
})
