import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, openNewWorkspace, test } from './helpers'

const VERSION = (JSON.parse(readFileSync(path.resolve('../../package.json'), 'utf8')) as { version: string }).version

test('shows the version of the copy and, when there is a newer one, how to update', async ({ page }) => {
  await openNewWorkspace(page, 'Versiones E2E')
  await page.getByRole('button', { name: /Lucía Martín/ }).click()
  await page.getByRole('menuitem', { name: 'Ajustes' }).click()
  const copy = page.getByRole('heading', { name: 'Esta copia', exact: true }).locator('xpath=ancestor::section[1]')
  await expect(copy).toContainText(`Orqevio ${VERSION}`)
  await expect(page.getByLabel('Hay una versión nueva de Orqevio')).toHaveCount(0)

  // A newer version is not published yet, so the answer of this copy is staged.
  await page.route('**/api/updates', (route) =>
    route.fulfill({
      json: {
        current: VERSION,
        latest: '99.0.0',
        updateAvailable: true,
        install: 'docker',
        copyName: null,
        releaseUrl: 'https://github.com/hsylabs/orqevio/releases/tag/v99.0.0',
      },
    }),
  )
  await page.reload()
  await expect(copy.getByRole('status')).toContainText('Hay una versión nueva: 99.0.0')
  await expect(copy.locator('code')).toHaveText('docker compose pull && docker compose up -d')
  await expect(copy.getByRole('button', { name: 'Copiar la orden' })).toBeVisible()
  await expect(copy.getByRole('link', { name: 'Ver las novedades' })).toHaveAttribute('href', 'https://github.com/hsylabs/orqevio/releases/tag/v99.0.0')
  await expect(page.getByLabel('Hay una versión nueva de Orqevio')).toBeVisible()
  await page.getByRole('button', { name: /Lucía Martín/ }).click()
  await expect(page.getByRole('menuitem', { name: /Ajustes/ })).toContainText('Nueva versión')
})
