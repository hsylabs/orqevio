import type { Page } from '@playwright/test'
import { createProject, expect, openNewWorkspace, test } from './helpers'

// Images with a width and a caption, as in Notion: a bar above the image and a handle on its edge.
// What is saved is what GitHub reads: the <img> tag with its width, and the caption as its title.

/** A picture 600×300, made in the browser and uploaded to the page. */
async function upload(page: Page, pageId: string) {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 600
    canvas.height = 300
    const context = canvas.getContext('2d')!
    context.fillStyle = '#3b82f6'
    context.fillRect(0, 0, 600, 300)
    context.fillStyle = '#fbbf24'
    context.fillRect(40, 40, 200, 120)
    return canvas.toDataURL('image/png').split(',')[1]!
  })
  const uploaded = await page.request.post(`/api/pages/${pageId}/attachments`, { headers: { 'Content-Type': 'image/png', 'X-File-Name': 'captura.png' }, data: Buffer.from(base64, 'base64') })
  expect(uploaded.status(), await uploaded.text()).toBe(201)
  return ((await uploaded.json()) as { url: string }).url
}

async function openPage(page: Page, name: string, content: (url: string) => string) {
  await page.goto('/')
  const workspace = (await (await page.request.post('/api/workspaces', { data: { name } })).json()) as { id: string }
  const project = (await (await page.request.post(`/api/workspaces/${workspace.id}/projects`, { data: { name: 'Notas' } })).json()) as { id: string }
  const created = await page.request.post(`/api/projects/${project.id}/pages`, { data: { title: 'Capturas' } })
  const pageId = ((await created.json()) as { id: string }).id
  const url = await upload(page, pageId)
  const markdown = content(url)
  const saved = await page.request.patch(`/api/pages/${pageId}`, { data: { content: markdown, baseVersion: 1 } })
  expect(saved.status(), await saved.text()).toBe(200)
  await page.goto(`/w/${workspace.id}/d/${pageId}`)
  const editor = page.getByRole('textbox', { name: 'Contenido de la página' })
  await expect(editor).toBeVisible()
  const read = async () => ((await (await page.request.get(`/api/pages/${pageId}`)).json()) as { content: string }).content.trim()
  return { editor, read, url }
}

test('an image takes a width and a caption from its bar, each undone on its own', async ({ page }) => {
  const { editor, read, url } = await openPage(page, 'Imágenes E2E', (src) => `Antes\n\n![captura](${src})\n\nDespués`)
  const image = editor.locator('.orq-image')
  await expect(image.locator('img')).toBeVisible()
  await image.locator('img').click()
  const bar = page.getByRole('toolbar', { name: 'Imagen' })
  await expect(bar).toBeVisible()
  await expect(bar.getByRole('button', { name: 'Tamaño original' })).toHaveAttribute('aria-pressed', 'true')

  // A share of the line: the <img> tag GitHub sizes.
  await bar.getByRole('button', { name: /Ancho: 50/ }).click()
  await expect.poll(read).toBe(`Antes\n\n<img src="${url}" alt="captura" width="50%">\n\nDespués`)
  await expect(bar.getByRole('button', { name: /Ancho: 50/ })).toHaveAttribute('aria-pressed', 'true')
  const line = await editor.locator('p').first().boundingBox()
  const box = await image.boundingBox()
  expect(Math.abs(box!.width - line!.width / 2)).toBeLessThan(4)

  // Its caption, under it: the image's title.
  await bar.getByRole('button', { name: 'Pie de imagen' }).click()
  await page.getByRole('textbox', { name: 'Pie de imagen' }).fill('El tablero, con la tarjeta abierta')
  await page.keyboard.press('Enter')
  await expect.poll(read).toBe(`Antes\n\n<img src="${url}" alt="captura" title="El tablero, con la tarjeta abierta" width="50%">\n\nDespués`)
  await expect(image.locator('.orq-image-caption')).toHaveText('El tablero, con la tarjeta abierta')

  // Each change is undone on its own.
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(read).toBe(`Antes\n\n<img src="${url}" alt="captura" width="50%">\n\nDespués`)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(read).toBe(`Antes\n\n![captura](${url})\n\nDespués`)
})

test('an image takes any width by dragging its edge, and the bar is reached with the keyboard', async ({ page }) => {
  const { editor, read, url } = await openPage(page, 'Imágenes arrastre E2E', (src) => `![captura](${src})`)
  const image = editor.locator('.orq-image')
  await image.locator('img').hover()
  const handle = image.locator('.orq-image-handle')
  await expect(handle).toBeVisible()
  const grip = (await handle.boundingBox())!
  const line = (await editor.locator('p').first().boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x - 150, grip.y + grip.height / 2, { steps: 8 })
  await page.mouse.up()
  // 600 px less 150, as a share of the line.
  const expected = Math.round(((600 - 150) / line.width) * 100)
  await expect.poll(read).toMatch(new RegExp(`^<img src="${url.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}" alt="captura" width="(\\d+)%">$`))
  const share = Number(/width="(\d+)%"/.exec(await read())![1])
  expect(Math.abs(share - expected)).toBeLessThanOrEqual(2)

  // Selected, Alt+F10 goes to its bar; the arrows move along it; Escape comes back.
  await page.keyboard.press('Alt+F10')
  const bar = page.getByRole('toolbar', { name: 'Imagen' })
  await expect(bar.getByRole('button', { name: /Ancho: 25/ })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(bar.getByRole('button', { name: /Ancho: 100/ })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect.poll(read).toBe(`<img src="${url}" alt="captura" width="100%">`)
  await page.keyboard.press('Escape')
  await expect(editor).toBeFocused()
})

test('in a comment, an image shows its caption under it', async ({ page }) => {
  const workspaceId = await openNewWorkspace(page, 'Imágenes comentario E2E')
  const boardId = await createProject(page, 'Notas')
  const columns = ((await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string }> }).columns
  const card = (await (await page.request.post(`/api/columns/${columns[0]!.id}/cards`, { data: { title: 'Revisión' } })).json()) as { id: string }
  const src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
  await page.request.post(`/api/cards/${card.id}/comments`, { data: { body: `![punto](/favicon.svg "Así queda")\n\n<img src="${src}">` } })
  await page.goto(`/w/${workspaceId}/b/${boardId}?card=${card.id}`)
  const comment = page.locator('.orq-prose--note').filter({ hasText: 'Así queda' })
  await expect(comment.locator('.orq-image-caption')).toHaveText('Así queda')
  // A picture of data in the address stays the HTML it was, as text.
  await expect(comment).toContainText('<img src="data:image/gif')
})

test.describe('on a phone', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

  test('its width changes with a tap', async ({ page }) => {
    const { editor, read, url } = await openPage(page, 'Imágenes móvil E2E', (src) => `![captura](${src})`)
    await editor.locator('.orq-image img').tap()
    await page.getByRole('toolbar', { name: 'Imagen' }).getByRole('button', { name: /Ancho: 75/ }).tap()
    await expect.poll(read).toBe(`<img src="${url}" alt="captura" width="75%">`)
    await page.screenshot({ path: test.info().outputPath('phone.png') })
  })
})
