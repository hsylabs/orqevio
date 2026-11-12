import { addCard, createProject, expect, openNewWorkspace, test } from './helpers'

// A 1×1 PNG.
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

test('pasting or attaching a file stores it as an attachment', async ({ page }) => {
  await openNewWorkspace(page, 'Adjuntos E2E')
  await createProject(page, 'Diseño')
  const boardUrl = page.url()

  // Pasting an image into a document uploads it and shows it from this copy.
  await page.getByRole('button', { name: 'Nueva página en Diseño' }).click({ force: true })
  await page.waitForURL(/\/d\//)
  await page.getByLabel('Título de la página').fill('Capturas')
  await page.keyboard.press('Enter')
  const upload = page.waitForResponse((r) => r.url().includes('/attachments') && r.request().method() === 'POST')
  await page.locator('.orq-prose').evaluate((editor, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const data = new DataTransfer()
    data.items.add(new File([bytes], 'captura de pantalla.png', { type: 'image/png' }))
    // Firefox drops the clipboardData given to the constructor of a synthetic event, so set it on the event.
    const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { value: data })
    editor.dispatchEvent(paste)
  }, PIXEL)
  const response = await upload
  expect(response.status()).toBe(201)
  expect(response.request().headers()['content-type']).toBe('image/png')
  const image = page.locator('.orq-prose img[src^="/api/attachments/"]')
  await expect(image).toBeVisible()
  await expect(image).toHaveAttribute('alt', 'captura de pantalla.png')
  expect(await image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(1)
  await expect(page.getByText('Guardado')).toBeVisible()
  await page.reload()
  await expect(page.locator('.orq-prose img[src^="/api/attachments/"]')).toBeVisible()

  // A file attached to a card is listed and can be downloaded with its name.
  await page.goto(boardUrl)
  await addCard(page, 'Por hacer', 'Revisar el informe')
  await page.getByRole('button', { name: 'Revisar el informe' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Adjuntar archivo' }).click()
  await (await chooser).setFiles({ name: 'informe técnico.txt', mimeType: 'text/plain', buffer: Buffer.from('Contenido del informe') })
  const link = page.getByRole('link', { name: 'informe técnico.txt', exact: true })
  await expect(link).toBeVisible()
  const href = await link.getAttribute('href')
  const body = await page.evaluate(async (url) => (await fetch(url!)).text(), href)
  expect(body).toBe('Contenido del informe')

  // Files over the copy's limit are refused with the real reason, before uploading.
  const oversized = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Adjuntar archivo' }).click()
  await (await oversized).setFiles({ name: 'enorme.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(21 * 1024 * 1024) })
  await expect(page.getByText('El archivo supera el tamaño máximo permitido.')).toBeVisible()
})
