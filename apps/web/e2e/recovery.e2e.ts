import { behindProxy, expect, settle, test } from './helpers'

// Contexts made in a test inherit the owner's session unless told otherwise.
test('the recovery form is there from the start, and says when the new code has not arrived', async ({ browser, baseURL }) => {
  const visitor = await browser.newContext({ ...behindProxy, locale: 'es-ES', baseURL, storageState: { cookies: [], origins: [] } })
  try {
    const page = await visitor.newPage()
    await settle(page, baseURL!)
    await page.goto('/login')
    await page.getByRole('button', { name: '¿Has perdido la clave?' }).click()
    // The steps for this copy (run from the repository, or deployed as a copy on Cloudflare),
    // and the form for a new code, without waiting for one.
    await expect(page.getByText(/pnpm cli reset-access|npx create-orqevio@latest recover/)).toBeVisible()
    await page.getByLabel('Nuevo código de configuración', { exact: true }).fill('a-code-not-set-yet')
    await page.getByRole('radio', { name: /He perdido la clave/ }).check()
    await page.getByRole('button', { name: 'Recuperar el acceso' }).click()
    // The copy still has the code it was claimed with: nothing changes, and it says why.
    await expect(page.getByText('Tu copia todavía no tiene un código de configuración nuevo')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Hola de nuevo' })).toBeVisible()
  } finally {
    await visitor.close()
  }
})
