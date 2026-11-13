import { OWNER_STATE, expect, openNewWorkspace, test } from './helpers'

test('the app speaks the language of the account, chosen in Settings', async ({ page, browser, baseURL }) => {
  await openNewWorkspace(page, 'Idiomas E2E')
  try {
    // The copy was claimed from a Spanish browser, so the account speaks Spanish.
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
    await page.getByRole('button', { name: /Lucía Martín/ }).click()
    await page.getByRole('menuitem', { name: 'Ajustes' }).click()
    // All eight languages are offered, each in its own name.
    await expect(page.getByLabel('Idioma', { exact: true }).locator('option')).toHaveText(['English', 'Español', 'Français', 'Português', 'Italiano', 'Deutsch', 'Nederlands', '日本語'])
    await page.getByLabel('Idioma', { exact: true }).selectOption('en')
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')

    // New boards get their default columns in the account's language.
    await page.getByRole('button', { name: 'New project' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'New project' })
    await dialog.getByLabel('Name').fill('Launch')
    await dialog.getByRole('button', { name: 'Create project' }).click()
    await expect(page.getByRole('region', { name: 'Column To do' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Column Done' })).toBeVisible()

    // Another device signed in to the account follows it, whatever its browser says.
    const device = await browser.newContext({ storageState: OWNER_STATE, locale: 'es-ES', baseURL })
    const other = await device.newPage()
    await other.goto('/')
    await expect(other.getByRole('link', { name: 'Home' })).toBeVisible()
    await device.close()

    // Before signing in, a device uses its own language, and the picker changes it.
    // Contexts made in a test inherit the owner's session unless told otherwise.
    const visitor = await browser.newContext({ locale: 'en-US', baseURL, storageState: { cookies: [], origins: [] } })
    const signIn = await visitor.newPage()
    await signIn.goto('/login')
    await expect(signIn.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
    await signIn.getByLabel('Language').selectOption('es')
    await expect(signIn.getByRole('heading', { name: 'Hola de nuevo' })).toBeVisible()
    await visitor.close()

    // Back to Spanish from Settings.
    await page.getByRole('button', { name: /Lucía Martín/ }).click()
    await page.getByRole('menuitem', { name: 'Settings' }).click()
    await page.getByLabel('Language', { exact: true }).selectOption('es')
    await expect(page.getByRole('heading', { name: 'Ajustes', level: 1 })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  } finally {
    // The other tests share this copy and expect it in Spanish.
    await page.request.patch('/api/account', { data: { locale: 'es' } })
  }
})
