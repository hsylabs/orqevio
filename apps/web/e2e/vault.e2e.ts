import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, openNewWorkspace, test } from './helpers'

/** RFC 6238 codes for the counters around now, as an authenticator app would compute them. */
function authenticatorCodes(secret: string) {
  const now = Math.floor(Date.now() / 30_000)
  return [now - 1, now, now + 1].map((counter) => {
    const message = Buffer.alloc(8)
    message.writeBigUInt64BE(BigInt(counter))
    const mac = createHmac('sha1', secret).update(message).digest()
    const offset = mac[mac.length - 1]! & 0x0f
    return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0')
  })
}

test('end-to-end encrypted vault', async ({ page }) => {
  test.setTimeout(90_000)
  await openNewWorkspace(page, 'Bóveda E2E')
  await page.getByRole('link', { name: /^Bóveda/ }).click()
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

  // Two-step verification codes, computed in the browser: an otpauth:// link fills in
  // the service and the account, and the code is the one an authenticator app shows.
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Credencial' }).click()
  const totpField = page.getByLabel('Verificación en dos pasos (TOTP)')
  await totpField.fill('contraseña 1234')
  await page.getByRole('button', { name: 'Cifrar y guardar' }).click()
  await expect(page.getByText('La clave secreta solo puede tener letras de la A a la Z y números del 2 al 7.')).toBeVisible()
  // "12345678901234567890", the RFC 6238 test secret, in base32.
  await totpField.fill('otpauth://totp/GitHub:lucia?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=GitHub')
  await expect(page.getByLabel('Nombre')).toHaveValue('GitHub')
  await expect(page.getByLabel('Usuario o correo')).toHaveValue('lucia')
  await page.getByRole('button', { name: 'Cifrar y guardar' }).click()
  await expect(page.getByRole('heading', { name: 'GitHub' })).toBeVisible()
  const code = page.getByLabel('Código de verificación actual')
  await expect(code).toHaveText(/^\d{3} \d{3}$/)
  expect(authenticatorCodes('12345678901234567890')).toContain((await code.innerText()).replace(/\s/g, ''))
  await expect(page.getByLabel(/^Cambia en \d+ segundos$/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copiar código' })).toBeVisible()
  // The secret is encrypted with the rest of the item.
  const stored = await page.evaluate(async () => (await (await fetch('/api/vault/items')).json()) as Array<{ data: string }>)
  expect(stored.map((r) => r.data).join(' ')).not.toContain('GEZDGNBV')

  // Import a browser export: new entries come in, copies of existing ones are skipped.
  const options = page.getByRole('button', { name: 'Opciones de la bóveda' })
  await options.click()
  await page.getByRole('menuitem', { name: 'Importar…' }).click()
  const importDialog = page.getByRole('dialog', { name: 'Importar a la bóveda' })
  const chooser = page.waitForEvent('filechooser')
  await importDialog.getByRole('button', { name: 'Elegir archivo' }).click()
  await (await chooser).setFiles({
    name: 'Contraseñas de Chrome.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('name,url,username,password,note\nCorreo,https://mail.example.com,lucia,"m,a""il",\nBanco,,lucia@example.com,S3cr3to-muy-largo!,\n'),
  })
  await expect(importDialog.getByRole('status')).toContainText('Desde Chrome o Edge')
  await expect(importDialog.getByRole('status')).toContainText('1 credencial nueva')
  await expect(importDialog.getByRole('status')).toContainText('1 elemento ya estaba en tu bóveda')
  await importDialog.getByRole('button', { name: 'Importar 1 elemento' }).click()
  await expect(importDialog).toBeHidden()
  await expect(page.getByRole('list', { name: 'Elementos de la bóveda' }).getByText('Correo')).toBeVisible()

  // Export, encrypted: only the master password opens it.
  await options.click()
  await page.getByRole('menuitem', { name: 'Exportar…' }).click()
  const exportDialog = page.getByRole('dialog', { name: 'Exportar la bóveda' })
  await exportDialog.getByLabel('Contraseña maestra').fill('no-es-esta')
  await exportDialog.getByRole('button', { name: 'Exportar cifrada' }).click()
  await expect(exportDialog.getByText('Contraseña maestra incorrecta.')).toBeVisible({ timeout: 30_000 })
  await exportDialog.getByLabel('Contraseña maestra').fill('otra frase maestra larga')
  const encryptedDownload = page.waitForEvent('download')
  await exportDialog.getByRole('button', { name: 'Exportar cifrada' }).click()
  const encryptedFile = await encryptedDownload
  expect(encryptedFile.suggestedFilename()).toMatch(/^orqevio-boveda-cifrada-\d{4}-\d{2}-\d{2}\.json$/)
  const encryptedText = await readFile((await encryptedFile.path())!, 'utf8')
  expect(JSON.parse(encryptedText)).toMatchObject({ format: 'orqevio-vault-export', count: 3, kdf: { algorithm: 'argon2id' } })
  expect(encryptedText).not.toContain('Correo')

  // Export without encryption needs the warning to be acknowledged.
  await options.click()
  await page.getByRole('menuitem', { name: 'Exportar…' }).click()
  await exportDialog.getByRole('radio', { name: 'Sin cifrar' }).click()
  await exportDialog.getByLabel('Contraseña maestra').fill('otra frase maestra larga')
  await expect(exportDialog.getByRole('button', { name: 'Exportar sin cifrar' })).toBeDisabled()
  await exportDialog.getByLabel(/Entiendo que el archivo no está cifrado/).check()
  const plainDownload = page.waitForEvent('download')
  await exportDialog.getByRole('button', { name: 'Exportar sin cifrar' }).click()
  const plain = JSON.parse(await readFile((await (await plainDownload).path())!, 'utf8'))
  expect(plain.encrypted).toBe(false)
  expect(plain.items.map((i: { name: string }) => i.name).sort()).toEqual(['Banco', 'Correo', 'GitHub'])
  expect(plain.items.find((i: { name: string }) => i.name === 'GitHub').login.totp).toContain('otpauth://totp/GitHub')

  // The encrypted copy comes back with its password, and everything in it is already here.
  await options.click()
  await page.getByRole('menuitem', { name: 'Importar…' }).click()
  const again = page.waitForEvent('filechooser')
  await importDialog.getByRole('button', { name: 'Elegir archivo' }).click()
  await (await again).setFiles({ name: 'copia.json', mimeType: 'application/json', buffer: Buffer.from(encryptedText) })
  await importDialog.getByLabel('Contraseña de la copia').fill('otra frase maestra larga')
  await importDialog.getByRole('button', { name: 'Descifrar' }).click()
  await expect(importDialog.getByRole('status')).toContainText('3 elementos ya estaban en tu bóveda', { timeout: 30_000 })
  await expect(importDialog.getByRole('button', { name: 'Importar 0 elementos' })).toBeDisabled()
})
