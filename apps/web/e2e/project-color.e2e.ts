import type { Locator } from '@playwright/test'
import { expect, openNewWorkspace, test } from './helpers'

/** The colour an element is drawn with, as the theme resolves it. */
const tone = (element: Locator) => element.evaluate((el) => getComputedStyle(el).getPropertyValue('--c').trim())

// A project's colour can be one of its own, besides the palette's nine: chosen with the browser's
// picker, kept as it was chosen, and drawn with a tone for each theme that stands out as theirs do.
test('a project takes a colour of its own, kept on reload, in both themes, and chosen again from the palette', async ({ page }) => {
  await openNewWorkspace(page, 'Color E2E')
  await page.getByRole('button', { name: 'Nuevo proyecto' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Nombre').fill('Mudanza')
  const custom = dialog.getByRole('radio', { name: 'Color personalizado' })
  await expect(custom).toHaveAttribute('aria-checked', 'false')
  const picker = dialog.locator('input[type="color"]')

  // A tap or a click on the swatch lands on the browser's own picker, which every browser opens, iPhone included.
  // Measured again until the dialog has come in: it moves while it does, so a point taken then may miss.
  await expect
    .poll(async () => {
      const box = (await custom.boundingBox())!
      return page.evaluate(({ x, y }) => (document.elementFromPoint(x, y) as HTMLInputElement | null)?.type, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    })
    .toBe('color')
  // From the keyboard, the swatch opens it too, starting from the colour chosen as the light theme has it (cobalt),
  // whatever the theme: that is the colour kept.
  await page.emulateMedia({ colorScheme: 'dark' })
  type Opened = { value: string; focused: boolean }
  const opened = () => page.evaluate(() => (window as unknown as { opened?: Opened[] }).opened)
  await page.evaluate(() => {
    const click = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
      const win = window as unknown as { opened?: Opened[] }
      if (this.type === 'color') win.opened = [...(win.opened ?? []), { value: this.value, focused: document.activeElement === this }]
      else click.call(this)
    }
  })
  await custom.focus()
  await page.keyboard.press('Enter')
  expect(await opened()).toEqual([{ value: '#3a6ae0', focused: false }])
  await expect(custom).toBeFocused()
  // On a touch screen (VoiceOver, an iPad's keyboard) it is focus that opens it: the picker takes it first.
  await page.evaluate(() => Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 }))
  await custom.focus()
  await page.keyboard.press('Enter')
  expect((await opened())?.[1]).toEqual({ value: '#3a6ae0', focused: true })
  await page.emulateMedia({ colorScheme: 'light' })

  // The browser's own picker is outside the page: what it hands back lands in its input.
  await picker.fill('#8b4513')
  const chosen = dialog.getByRole('radio', { name: 'Color personalizado (#8b4513)' })
  await expect(chosen).toHaveAttribute('aria-checked', 'true')
  await expect(dialog.getByRole('radio', { name: 'Cobalto' })).toHaveAttribute('aria-checked', 'false')
  await dialog.getByRole('button', { name: 'Crear proyecto' }).click()
  await page.waitForURL(/\/b\/[0-9a-f-]{36}/)

  // A colour the palette could have shows as chosen in the light theme.
  const glyph = page.getByRole('navigation').getByRole('link', { name: 'M Mudanza', exact: true }).locator('.glyph')
  await expect.poll(() => tone(glyph)).toBe('#8b4513')
  await expect(page.getByRole('region', { name: 'Columna Por hacer' })).toBeVisible()
  await page.reload()
  await expect.poll(() => tone(glyph)).toBe('#8b4513')

  // The dark theme draws it lighter, both when it follows the system and when it is chosen.
  await page.emulateMedia({ colorScheme: 'dark' })
  const dark = await tone(glyph)
  expect(dark).not.toBe('#8b4513')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
  await expect.poll(() => tone(glyph)).toBe(dark)
  // And chosen light while the system is dark, the light tone.
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'))
  await expect.poll(() => tone(glyph)).toBe('#8b4513')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.evaluate(() => delete document.documentElement.dataset.theme)

  // Too light to stand out from the page: the project page draws it darker, and the dialog shows it as it will look.
  await glyph.click()
  await page.waitForURL(/\/p\/[0-9a-f-]{36}$/)
  await page.getByRole('button', { name: 'Editar' }).click()
  await expect(dialog.getByRole('radio', { name: 'Color personalizado (#8b4513)' })).toHaveAttribute('aria-checked', 'true')
  await picker.fill('#fafafa')
  const pale = dialog.getByRole('radio', { name: 'Color personalizado (#fafafa)' })
  await expect(pale).toHaveAttribute('aria-checked', 'true')
  const shown = await tone(pale)
  expect(shown).not.toBe('#fafafa')
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await expect(dialog).toBeHidden()
  const header = page.locator('main .glyph').first()
  await expect.poll(() => tone(header)).toBe(shown)
  await expect.poll(() => tone(glyph)).toBe(shown)

  // And back to the palette.
  await page.getByRole('button', { name: 'Editar' }).click()
  await expect(pale).toHaveAttribute('aria-checked', 'true')
  await dialog.getByRole('radio', { name: 'Jade' }).click()
  await expect(dialog.getByRole('radio', { name: 'Color personalizado' })).toHaveAttribute('aria-checked', 'false')
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await expect(glyph).toHaveClass(/\bc-jade\b/)
  await page.reload()
  await expect(glyph).toHaveClass(/\bc-jade\b/)
})
