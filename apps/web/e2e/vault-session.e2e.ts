import { readFile } from 'node:fs/promises'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { ACCESS_KEY_FILE, behindProxy, expect, settle, test } from './helpers'

const MASTER = 'frase maestra al cerrar la sesión'
const SECRET = 'Secreta-4321'

async function signIn(page: Page, accessKey: string) {
  await page.getByLabel('Clave de acceso', { exact: true }).fill(accessKey)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
}

/**
 * A browser of its own, signed in with the access key, with a vault holding one login whose
 * password is shown in a second tab. Signing it out leaves the other tests' session alone.
 */
async function vaultOpenInTwoTabs(browser: Browser, baseURL: string, accessKey: string) {
  const context = await browser.newContext({ ...behindProxy, baseURL, storageState: { cookies: [], origins: [] }, locale: 'es-ES', timezoneId: 'Europe/Madrid' })
  const page = await context.newPage()
  await settle(page, baseURL)
  await page.goto('/login')
  await signIn(page, accessKey)
  await expect(page.getByRole('button', { name: 'Nuevo proyecto' }).first()).toBeVisible()
  const created = await page.request.post('/api/workspaces', { data: { name: 'Cerrar sesión E2E' } })
  expect(created.status()).toBe(201)
  const vaultUrl = `/w/${((await created.json()) as { id: string }).id}/vault`
  await page.goto(vaultUrl)
  await page.getByLabel('Contraseña maestra', { exact: true }).fill(MASTER)
  await page.getByLabel('Repite la contraseña maestra').fill(MASTER)
  await page.getByRole('button', { name: 'Crear bóveda' }).click()
  await page.getByLabel('La he guardado en un lugar seguro, fuera de Orqevio.').check({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Abrir mi bóveda' }).click()
  await page.getByRole('button', { name: 'Nueva credencial' }).click()
  await page.getByLabel('Nombre').fill('Correo')
  await page.getByLabel('Contraseña', { exact: true }).fill(SECRET)
  await page.getByRole('button', { name: 'Cifrar y guardar' }).click()
  await expect(page.getByRole('heading', { name: 'Correo' })).toBeVisible()

  const other = await context.newPage()
  await settle(other, baseURL)
  await other.goto(vaultUrl)
  await other.getByLabel('Contraseña maestra').fill(MASTER)
  await other.getByRole('button', { name: 'Desbloquear' }).click()
  await other.getByRole('button', { name: 'Mostrar contraseña' }).click({ timeout: 30_000 })
  await expect(other.getByText(SECRET)).toBeVisible()
  return { context, page, other, vaultUrl }
}

/** Signed in again in `page`, the vault is locked: it asks for the master password, and opens with it. */
async function asksForTheMasterPassword(page: Page, accessKey: string, vaultUrl: string) {
  await expect(page).toHaveURL(/\/login/, { timeout: 40_000 })
  await signIn(page, accessKey)
  await expect(page).toHaveURL(new RegExp(`${vaultUrl}$`))
  await expect(page.getByRole('button', { name: 'Desbloquear' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Correo' })).toHaveCount(0)
  await expect(page.getByText(SECRET)).toHaveCount(0)
  await page.getByLabel('Contraseña maestra').fill(MASTER)
  await page.getByRole('button', { name: 'Desbloquear' }).click()
  await expect(page.getByRole('heading', { name: 'Correo' })).toBeVisible({ timeout: 30_000 })
}

// Signing out in one tab locks the vault in the other tabs of the browser at once, and they show
// the sign-in screen. Signing in again there asks for the master password.
test('signing out in one tab locks the vault in the others, and signing in again asks for the master password', async ({ page, browser, baseURL }) => {
  test.setTimeout(150_000)
  const accessKey = (await readFile(ACCESS_KEY_FILE, 'utf8')).trim()
  const reset = async () => expect((await page.request.post('/api/vault/reset', { data: { accessKey } })).status()).toBe(204)
  await reset()
  let context: BrowserContext | undefined
  try {
    const opened = await vaultOpenInTwoTabs(browser, baseURL!, accessKey)
    context = opened.context
    await opened.page.getByRole('button', { name: /Lucía Martín/ }).click()
    await opened.page.getByRole('menuitem', { name: 'Cerrar sesión' }).click()
    await expect(opened.page).toHaveURL(/\/login/)

    // The other tab hides the password at once, without waiting for its live connection's ping.
    await expect(opened.other.getByText(SECRET)).toHaveCount(0, { timeout: 3000 })
    await expect(opened.other).toHaveURL(/\/login/, { timeout: 10_000 })
    await asksForTheMasterPassword(opened.other, accessKey, opened.vaultUrl)
  } finally {
    await context?.close()
    await reset()
  }
})

// A session that ended without this browser's app knowing (signed out by another program, expired,
// a backup restored): the tab drops the vault key as soon as a request is refused for it, and
// signing in again asks for the master password.
test('a tab whose session ended elsewhere drops the vault key, and signing in again asks for the master password', async ({ page, browser, baseURL }) => {
  test.setTimeout(150_000)
  const accessKey = (await readFile(ACCESS_KEY_FILE, 'utf8')).trim()
  const reset = async () => expect((await page.request.post('/api/vault/reset', { data: { accessKey } })).status()).toBe(204)
  await reset()
  let context: BrowserContext | undefined
  try {
    const opened = await vaultOpenInTwoTabs(browser, baseURL!, accessKey)
    context = opened.context
    await opened.page.close()
    // Ended by a request the app does not see, so nothing tells the tab.
    const outside = await context.newPage()
    await settle(outside, baseURL!)
    expect(await outside.evaluate(async () => (await fetch('/api/auth/logout', { method: 'POST' })).status)).toBeLessThan(300)
    await outside.close()

    // The next thing the tab asks of the server is refused: the vault locks at once, and says why.
    await opened.other.getByRole('button', { name: 'Marcar como favorito' }).click()
    await expect(opened.other.getByText(SECRET)).toHaveCount(0, { timeout: 3000 })
    await expect(opened.other.getByText('Tu sesión ha terminado. Vuelve a entrar.')).toBeVisible()
    await asksForTheMasterPassword(opened.other, accessKey, opened.vaultUrl)
  } finally {
    await context?.close()
    await reset()
  }
})
