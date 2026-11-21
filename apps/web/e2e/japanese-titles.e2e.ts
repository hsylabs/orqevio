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

/** Where on screen a character of `root`'s text is: a quarter into it, halfway down. */
const pointAt = (root: Locator, at: number) =>
  root.evaluate((el, at) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let offset = 0
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent?.length ?? 0
      if (at < offset + length) {
        const range = document.createRange()
        range.setStart(node, at - offset)
        range.setEnd(node, at - offset + 1)
        const rect = range.getBoundingClientRect()
        return { x: rect.left + rect.width / 4, y: rect.top + rect.height / 2 }
      }
      offset += length
    }
    throw new Error(`no character ${at}`)
  }, at)

/**
 * A title edited in place (a page's, a card's), holding TITLE: where only BudouX tells phrases
 * apart, it is drawn broken between them over its field until it is edited. The field, unseen,
 * fills the drawn title, so a click on any of its lines edits the field from the character clicked,
 * and the title doesn't move once edited.
 */
async function checkEditedInPlace(page: Page, field: Locator, native: boolean, shot: (name: string) => Promise<unknown>) {
  const drawn = field.locator('xpath=../div[@aria-hidden="true"]')
  const cell = field.locator('xpath=..')
  await field.blur()
  if (native) {
    await expect(drawn).toHaveCount(0)
    await shot('sin-editar')
    return
  }
  await expect(drawn).toBeVisible()
  await expect(drawn.locator('wbr')).toHaveCount(PHRASES.length - 1)
  await expect(field).toHaveCSS('opacity', '0')
  const starts = await lineStarts(drawn)
  expect(starts.length).toBeGreaterThan(0)
  for (const start of starts) expect(BOUNDARIES, `a line starts at «${TITLE.slice(start)}»`).toContain(start)
  const height = (await cell.boundingBox())!.height
  expect((await field.boundingBox())!.height).toBeCloseTo(height, 0)
  await shot('sin-editar')
  // The first character of each line and one inside a phrase: the field's own lines break
  // elsewhere, so left to itself it would put the caret at other characters.
  for (const at of [0, ...starts, TITLE.indexOf('書')]) {
    await field.blur()
    await expect(drawn).toBeVisible()
    const point = await pointAt(drawn, at)
    await page.mouse.click(point.x, point.y)
    await expect(field).toBeFocused()
    expect(await field.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd]), `clicked on «${TITLE.slice(at)}»`).toEqual([at, at])
    await expect(drawn).toBeHidden()
    await expect(field).toHaveCSS('opacity', '1')
    expect((await cell.boundingBox())!.height).toBeCloseTo(height, 0)
  }
  await shot('editando')
}

// Japanese has no spaces: a title breaks between its phrases, never inside a word. Chromium tells
// them apart itself; Firefox and Safari are told by BudouX, loaded only for them.
test('Japanese titles break between their phrases in every browser', async ({ page, browserName }, testInfo) => {
  const workspaceId = await openNewWorkspace(page, '日本語 E2E')
  await page.request.patch('/api/account', { data: { locale: 'ja' } })
  try {
    const project = (await (await page.request.post(`/api/workspaces/${workspaceId}/projects`, { data: { name: TITLE } })).json()) as { id: string }
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
    // Chromium tells phrases apart itself; the day another browser does too, BudouX isn't loaded there.
    if (browserName === 'chromium') expect(native).toBe(true)
    else if (native) testInfo.annotations.push({ type: 'native', description: `${browserName} tells phrases apart itself` })
    if (native) await expect(title.locator('wbr')).toHaveCount(0)
    else await expect(title.locator('wbr')).toHaveCount(PHRASES.length - 1)

    // At every width, each line starts where a phrase does; where only BudouX tells them apart, the
    // browser alone breaks inside a word at one of them at least (or this proves nothing).
    const card = title.locator('xpath=ancestor::p[1]')
    const widths = Array.from({ length: 14 }, (_, i) => 260 - i * 10)
    let plainMisses = 0
    for (const width of widths) {
      await card.evaluate((p, w) => (p.style.width = `${w}px`), width)
      const starts = await lineStarts(title)
      expect(starts.length, `${width}px`).toBeGreaterThan(0)
      for (const start of starts) expect(BOUNDARIES, `${width}px: a line starts at «${TITLE.slice(start)}»`).toContain(start)
      if (!native) plainMisses += (await plainStarts(page, title)).filter((start) => !BOUNDARIES.includes(start)).length
    }
    if (!native) expect(plainMisses).toBeGreaterThan(0)
    await card.evaluate((p) => p.style.removeProperty('width'))

    // A year stays whole at every width: BudouX's places to break inside it are taken away.
    const dated = page.locator('.orq-phrases', { hasText: DATED })
    const year = DATED.indexOf('2026')
    if (!native) {
      const breaks = await dated.evaluate((el) => {
        const at: number[] = []
        let offset = 0
        for (const node of el.childNodes) {
          if (node.nodeName === 'WBR') at.push(offset)
          else offset += node.textContent?.length ?? 0
        }
        return at
      })
      expect(breaks.length).toBeGreaterThan(0)
      for (const at of breaks) expect(at <= year || at >= year + 4, `a place to break at «${DATED.slice(at)}»`).toBe(true)
    }
    const datedCard = dated.locator('xpath=ancestor::p[1]')
    for (const width of widths) {
      await datedCard.evaluate((p, w) => (p.style.width = `${w}px`), width)
      for (const start of await lineStarts(dated)) expect(start <= year || start >= year + 4, `${width}px: «${DATED.slice(start)}»`).toBe(true)
    }
    await datedCard.evaluate((p) => p.style.removeProperty('width'))
    // A word too long for its line still breaks, and nothing runs out of its card.
    for (const text of [TITLE, DATED, LONG]) {
      const p = page.locator('.orq-phrases', { hasText: text }).locator('xpath=ancestor::p[1]')
      expect(await p.evaluate((el) => el.scrollWidth <= el.clientWidth), text).toBe(true)
    }
    await page.screenshot({ path: testInfo.outputPath('1-tablero.png'), animations: 'disabled' })

    // A card's title in its sheet, edited in place.
    await title.click()
    const cardField = page.getByRole('textbox', { name: 'カードのタイトル' })
    await expect(cardField).toHaveValue(TITLE)
    await checkEditedInPlace(page, cardField, native, (name) => page.screenshot({ path: testInfo.outputPath(`2-ficha-${name}.png`), animations: 'disabled' }))
    await cardField.blur()
    await page.keyboard.press('Escape')
    await expect(cardField).toBeHidden()

    // The project's name on its page, as wide as the window, breaks the same way (at widths where its
    // longest phrase fits on a line: narrower, that phrase breaks too, so as not to run out).
    await page.goto(`/w/${workspaceId}/p/${project.id}`)
    const name = page.getByRole('heading', { level: 1 }).locator('.orq-phrases')
    await expect(name).toHaveText(TITLE)
    if (!native) await expect(name.locator('wbr')).toHaveCount(PHRASES.length - 1)
    for (const width of [720, 640, 560, 480, 420, 390]) {
      await page.setViewportSize({ width, height: 844 })
      for (const start of await lineStarts(name)) expect(BOUNDARIES, `${width}px: «${TITLE.slice(start)}»`).toContain(start)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: testInfo.outputPath('3-proyecto.png'), animations: 'disabled' })

    // A page's title, edited in place too; typed into, it is drawn again with what was typed once left.
    await page.goto(`/w/${workspaceId}/d/${doc.id}`)
    const field = page.getByRole('textbox', { name: 'ページのタイトル' })
    await expect(field).toHaveValue(TITLE)
    await checkEditedInPlace(page, field, native, (name) => page.screenshot({ path: testInfo.outputPath(`4-pagina-${name}.png`), animations: 'disabled' }))
    await field.focus()
    await field.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length))
    await page.keyboard.type('！')
    await expect(field).toHaveValue(`${TITLE}！`)
    await page.keyboard.press('Tab')
    if (!native) await expect(field.locator('xpath=../div[@aria-hidden="true"]')).toHaveText(`${TITLE}！`)
  } finally {
    // The other tests share this copy and expect it in Spanish.
    await page.request.patch('/api/account', { data: { locale: 'es' } })
  }
})
