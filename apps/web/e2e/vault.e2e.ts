import { expect, signUp, test } from './helpers'

test('end-to-end encrypted vault', async ({ page }) => {
  test.setTimeout(90_000)
  await signUp(page)
  await page.getByRole('link', { name: 'Bóveda' }).click()
  await page.getByLabel('Contraseña maestra', { exact: true }).fill('caballo correcto pila grapa')
  await page.getByLabel('Repite la contraseña maestra').fill('caballo correcto pila grapa')
  await page.getByRole('button', { name: 'Crear bóveda' }).click()
  await expect(page.getByText('Guarda tu clave de recuperación')).toBeVisible({ timeout: 30_000 })
  const recoveryKey = (await page.locator('p.select-all').innerText()).trim()
  expect(recoveryKey).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/)
  await page.getByLabel('La he guardado en un lugar seguro, fuera de Orqevio.').check()
  await page.getByRole('button', { name: 'Abrir mi bóveda' }).click()

  await page.getByRole('button', { name: 'Nueva credencial' }).click()
  await page.getByLabel('Nombre').fill('Banco')
  await page.getByLabel('Usuario o correo').fill('lucia@example.com')
  await page.getByLabel('Contraseña', { exact: true }).fill('S3cr3to-muy-largo!')
  await page.getByRole('button', { name: 'Cifrar y guardar' }).click()
  await expect(page.getByRole('heading', { name: 'Banco' })).toBeVisible()

  // The server only stores ciphertext.
  const records = await page.evaluate(async () => (await fetch('/api/vault/items')).json())
  expect(records).toHaveLength(1)
  expect(records[0].data).toMatch(/^v1\./)
  expect(records[0].data).not.toContain('Banco')

  // Lock, reject a wrong password, unlock with the right one.
  await page.getByRole('button', { name: 'Bloquear' }).click()
  await page.getByLabel('Contraseña maestra').fill('no-es-esta-clave')
  await page.getByRole('button', { name: 'Desbloquear' }).click()
  await expect(page.getByText('Contraseña maestra incorrecta.')).toBeVisible({ timeout: 30_000 })
  await page.getByLabel('Contraseña maestra').fill('caballo correcto pila grapa')
  await page.getByRole('button', { name: 'Desbloquear' }).click()
  await expect(page.getByRole('heading', { name: 'Banco' })).toBeVisible({ timeout: 30_000 })

  // Reloading discards the key: the vault is locked again, and recovery works.
  await page.reload()
  await page.getByRole('button', { name: '¿Has olvidado la contraseña maestra?' }).click()
  await page.getByLabel('Clave de recuperación').fill(recoveryKey)
  await page.getByLabel('Nueva contraseña maestra').fill('otra frase maestra larga')
  await page.getByLabel('Repite la nueva contraseña').fill('otra frase maestra larga')
  await page.getByRole('button', { name: 'Restablecer y abrir' }).click()
  await expect(page.getByRole('heading', { name: 'Banco' })).toBeVisible({ timeout: 30_000 })
})
