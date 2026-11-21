import { expect, openNewWorkspace, test } from './helpers'

// Crossing 900 px: narrowing the window closes the side panel, as a phone opens with it closed, and
// widening brings it back as it was left on a wide window.
test('the side panel closes when the window narrows and comes back as it was when it widens', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openNewWorkspace(page, 'Panel lateral E2E')
  const nav = page.getByRole('navigation', { name: 'Navegación principal' })
  // Closed, the side panel is inert (off the screen on a phone, folded away on a wide window).
  const closed = () => nav.evaluate((el) => Boolean(el.closest('[inert]')))
  const toggle = page.getByRole('button', { name: 'Alternar barra lateral' })
  await expect.poll(closed).toBe(false)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(closed).toBe(true)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  // Nothing covers the page: its own button takes the click and opens the drawer.
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(closed).toBe(false)

  // Wide again, it is as the wide window had it: open.
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect.poll(closed).toBe(false)

  // Closed on the wide window, it stays closed after a round trip through a narrow one.
  await page.keyboard.press('ControlOrMeta+Backslash')
  await expect.poll(closed).toBe(true)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(closed).toBe(true)
})
