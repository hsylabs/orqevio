import type { Page } from '@playwright/test'
import { expect, openNewWorkspace, test } from './helpers'

// A phone: a finger instead of a mouse, and a narrow screen.
test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

/**
 * A finger on (x0, y0) that rests `hold` ms, then slides to (x1, y1) and lifts. Touch events built
 * in the page: Playwright taps, but does not drag a finger.
 */
async function slide(page: Page, [x0, y0]: [number, number], [x1, y1]: [number, number], hold: number) {
  await page.evaluate(
    async ({ x0, y0, x1, y1, hold }) => {
      const target = document.elementFromPoint(x0, y0)!
      // WebKit has no Touch constructor: it makes touches, and lists of them, the older way.
      type Legacy = { createTouch(...args: unknown[]): Touch; createTouchList(...touches: Touch[]): TouchList }
      const legacy = document as unknown as Legacy
      const modern = (() => {
        try {
          return Boolean(new Touch({ identifier: 1, target, clientX: x0, clientY: y0 }))
        } catch {
          return false
        }
      })()
      const touch = (x: number, y: number) =>
        modern ? new Touch({ identifier: 1, target, clientX: x, clientY: y, pageX: x, pageY: y }) : legacy.createTouch(window, target, 1, x, y, x, y)
      const list = (...touches: Touch[]) => (modern ? touches : legacy.createTouchList(...touches)) as Touch[]
      const fire = (type: string, x: number, y: number) => {
        const at = touch(x, y)
        const down = type === 'touchend' ? list() : list(at)
        target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: down, targetTouches: down, changedTouches: list(at) }))
      }
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
      fire('touchstart', x0, y0)
      await new Promise((resolve) => setTimeout(resolve, hold))
      for (let i = 1; i <= 12; i++) {
        fire('touchmove', x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * i) / 12)
        await frame()
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
      fire('touchend', x1, y1)
    },
    { x0, y0, x1, y1, hold },
  )
}

const centre = async (page: Page, title: string) => {
  const box = (await page.getByRole('button', { name: title, exact: true }).boundingBox())!
  return [box.x + box.width / 2, box.y + box.height / 2] as [number, number]
}

test('on a phone, a card is dragged by resting a finger on it, and moved up or down from its sheet', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const workspaceId = await openNewWorkspace(page, 'Móvil E2E')
  const project = (await (await page.request.post(`/api/workspaces/${workspaceId}/projects`, { data: { name: 'Recados', color: 'jade' } })).json()) as { id: string }
  const boardId = ((await (await page.request.post(`/api/projects/${project.id}/boards`, { data: { name: 'Calle' } })).json()) as { id: string }).id
  // On a phone the sidebar is folded away: open it, then the board.
  await page.getByRole('button', { name: 'Alternar barra lateral' }).first().click()
  await page.getByRole('navigation').getByRole('link', { name: /^Calle/ }).click()
  await page.waitForURL(`**/b/${boardId}`)
  const { columns } = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string }> }
  for (const title of ['Uno', 'Dos', 'Tres']) {
    expect((await page.request.post(`/api/columns/${columns[0]!.id}/cards`, { data: { title } })).status()).toBe(201)
  }
  const order = async () => {
    const board = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { cards: Array<{ title: string; columnId: string }> }
    return board.cards.filter((c) => c.columnId === columns[0]!.id).map((c) => c.title)
  }
  await expect(page.getByRole('button', { name: 'Tres', exact: true })).toBeVisible()

  // A quick swipe is for scrolling: nothing moves.
  await slide(page, await centre(page, 'Uno'), (await centre(page, 'Tres')).map((v, i) => (i ? v + 20 : v)) as [number, number], 0)
  await page.waitForTimeout(500)
  expect(await order()).toEqual(['Uno', 'Dos', 'Tres'])

  // Resting the finger a moment picks the card up: below «Tres» it goes.
  const [x, y] = await centre(page, 'Tres')
  await slide(page, await centre(page, 'Uno'), [x, y + 24], 400)
  await expect.poll(order).toEqual(['Dos', 'Tres', 'Uno'])
  await page.screenshot({ path: testInfo.outputPath('1-arrastrada-con-el-dedo.png'), animations: 'disabled' })

  // From its sheet, one place up, without dragging.
  await page.getByRole('button', { name: 'Uno', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Por hacer/ }).click()
  await expect(page.getByRole('menuitem', { name: 'Bajar' })).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath('2-subir-y-bajar.png'), animations: 'disabled' })
  await page.getByRole('menuitem', { name: 'Subir' }).click()
  await expect.poll(order).toEqual(['Dos', 'Uno', 'Tres'])
})
