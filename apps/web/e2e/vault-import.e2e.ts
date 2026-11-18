import { readFile } from 'node:fs/promises'
import { ACCESS_KEY_FILE, expect, openNewWorkspace, test } from './helpers'

// What a Bitwarden export has and the vault has no field for comes along in the notes, and the
// review says so, with what does not come along and why.
test('importing from Bitwarden keeps custom fields, every address and older passwords, and says what stays out', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const accessKey = (await readFile(ACCESS_KEY_FILE, 'utf8')).trim()
  // From no vault to no vault, whatever the other tests do with the owner's.
  const reset = async () => expect((await page.request.post('/api/vault/reset', { data: { accessKey } })).status()).toBe(204)
  await reset()
  try {
    const workspaceId = await openNewWorkspace(page, 'Importar E2E')
    await page.goto(`/w/${workspaceId}/vault`)
    await page.getByLabel('Contraseña maestra', { exact: true }).fill('frase maestra para importar')
    await page.getByLabel('Repite la contraseña maestra').fill('frase maestra para importar')
    await page.getByRole('button', { name: 'Crear bóveda' }).click()
    await page.getByLabel('La he guardado en un lugar seguro, fuera de Orqevio.').check({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Abrir mi bóveda' }).click()
    await expect(page.getByRole('button', { name: 'Bloquear' })).toBeVisible()

    const bitwarden = {
      encrypted: false,
      items: [
        {
          type: 1,
          name: 'Banco',
          notes: 'Cuenta nómina',
          login: { uris: [{ uri: 'https://banco.es' }, { uri: 'https://app.banco.es' }], username: 'ana', password: 'nueva', fido2Credentials: [{ credentialId: 'x' }] },
          fields: [{ name: 'PIN', value: '1234', type: 1 }],
          passwordHistory: [{ password: 'anterior', lastUsedDate: '2025-05-01T10:00:00.000Z' }],
        },
        { type: 2, name: 'Enorme', notes: 'n'.repeat(400_000), secureNote: { type: 0 } },
        { type: 3, name: 'Visa', card: { number: '4111' } },
      ],
    }
    await page.getByRole('button', { name: 'Opciones de la bóveda' }).click()
    await page.getByRole('menuitem', { name: 'Importar…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Importar a la bóveda' })
    const chooser = page.waitForEvent('filechooser')
    await dialog.getByRole('button', { name: 'Elegir archivo' }).click()
    await (await chooser).setFiles({ name: 'bitwarden.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bitwarden)) })
    const status = dialog.getByRole('status')
    await expect(status).toContainText('Desde Bitwarden (JSON)')
    await expect(status).toContainText('1 credencial nueva')
    await expect(status).toContainText('1 elemento trae campos personalizados, más direcciones o contraseñas anteriores: se guardan en sus notas')
    await expect(status).toContainText('1 credencial tiene una llave de acceso (passkey), que no se puede importar; el resto de la credencial, sí')
    await expect(status).toContainText('1 elemento no es compatible (tarjetas, identidades o claves SSH) y no se importa')
    await expect(status).toContainText('1 elemento es más grande de lo que admite la bóveda y no se importa: Enorme')
    await dialog.screenshot({ path: testInfo.outputPath('1-revision-bitwarden.png'), animations: 'disabled' })
    await dialog.getByRole('button', { name: 'Importar 1 elemento' }).click()
    await expect(dialog).toBeHidden()

    // The notes hold what the vault has no field for.
    await page.getByRole('list', { name: 'Elementos de la bóveda' }).getByText('Banco').click()
    await expect(page.getByText('Campos personalizados:')).toBeVisible()
    await expect(page.getByText('PIN: 1234')).toBeVisible()
    await expect(page.getByText('https://app.banco.es')).toBeVisible()
    await expect(page.getByText('anterior (2025-05-01)')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('2-notas-con-lo-importado.png'), animations: 'disabled' })
  } finally {
    await reset()
  }
})
