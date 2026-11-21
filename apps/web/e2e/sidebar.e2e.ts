import { expect, openNewWorkspace, test } from './helpers'

// Crossing 900 px: narrowing the window closes the side panel, as a phone opens with it closed, and
// widening brings it back as it was left on a wide window. Each step changes the panel's state, so
// each one needs the window's change to be heard.
test('the side panel closes when the window narrows and comes back as it was when it widens', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openNewWorkspace(page, 'Panel lateral E2E')
  // Closed on a wide window it is hidden as well, so the locator has to find it hidden too.
  const nav = page.getByRole('navigation', { name: 'Navegación principal', includeHidden: true })
  // Closed, the side panel is inert (off the screen on a phone, folded away on a wide window).
  const closed = () => nav.evaluate((el) => Boolean(el.closest('[inert]')))
  const focused = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)
  const toggle = page.getByRole('button', { name: 'Alternar barra lateral' })
  await expect.poll(closed).toBe(false)

  // Open on the wide window, with focus in it: narrowing closes it, and focus moves to the page.
  await nav.getByRole('link').first().focus()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(closed).toBe(true)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(focused).toBe('main')

  // Wide again, it opens, as the wide window had it.
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect.poll(closed).toBe(false)

  // Closed on the wide window, then opened on a narrow one: wide again, it is closed, as the wide window had it.
  await page.keyboard.press('ControlOrMeta+Backslash')
  await expect.poll(closed).toBe(true)
  await page.setViewportSize({ width: 390, height: 844 })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(closed).toBe(false)
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect.poll(closed).toBe(true)
})
