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
  await expect(dialog.getByRole('radio', { name: 'Color personalizado' })).toHaveAttribute('aria-checked', 'false')
  // The browser's own picker is outside the page: what it hands back lands in the input under the swatch.
  await dialog.locator('input[type="color"]').fill('#8b4513')
  const chosen = dialog.getByRole('radio', { name: 'Color personalizado (#8b4513)' })
  await expect(chosen).toHaveAttribute('aria-checked', 'true')
  await expect(dialog.getByRole('radio', { name: 'Cobalto' })).toHaveAttribute('aria-checked', 'false')
  await dialog.getByRole('button', { name: 'Crear proyecto' }).click()
  await page.waitForURL(/\/b\/[0-9a-f-]{36}/)

  // A colour the palette could have shows as chosen in the light theme.
  const glyph = page.getByRole('navigation').getByRole('link', { name: 'M Mudanza', exact: true }).locator('.glyph')
  await expect.poll(() => tone(glyph)).toBe('#8b4513')
  await page.reload()
  await expect.poll(() => tone(glyph)).toBe('#8b4513')

  // The dark theme draws it lighter, both when it follows the system and when it is chosen.
  await page.emulateMedia({ colorScheme: 'dark' })
  const dark = await tone(glyph)
  expect(dark).not.toBe('#8b4513')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
  await expect.poll(() => tone(glyph)).toBe(dark)
  await page.evaluate(() => delete document.documentElement.dataset.theme)

  // Too light to stand out from the page: the project page draws it darker, and the dialog shows it as it will look.
  await glyph.click()
  await page.waitForURL(/\/p\/[0-9a-f-]{36}$/)
  await page.getByRole('button', { name: 'Editar' }).click()
  await expect(dialog.getByRole('radio', { name: 'Color personalizado (#8b4513)' })).toHaveAttribute('aria-checked', 'true')
  await dialog.locator('input[type="color"]').fill('#fafafa')
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
