import { readFile } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'
import type { Download, Page } from '@playwright/test'
import { expect, openNewWorkspace, test } from './helpers'

/** The entries of a ZIP, by name: read from its central directory, each one stored or deflated. */
function unzip(zip: Buffer) {
  const files: Record<string, string> = {}
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  let at = zip.readUInt32LE(end + 16)
  for (let i = zip.readUInt16LE(end + 10); i > 0; i--) {
    const [method, size, nameLength] = [zip.readUInt16LE(at + 10), zip.readUInt32LE(at + 20), zip.readUInt16LE(at + 28)]
    const offset = zip.readUInt32LE(at + 42)
    const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28)
    const data = zip.subarray(start, start + size)
    files[zip.toString('utf8', at + 46, at + 46 + nameLength)] = (method === 8 ? inflateRawSync(data) : data).toString('utf8')
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32)
  }
  return files
}

/** A transparent pixel, as PNG. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

async function writePage(page: Page, id: string, content: string) {
  const { version } = (await (await page.request.get(`/api/pages/${id}`)).json()) as { version: number }
  const res = await page.request.patch(`/api/pages/${id}`, { data: { content, baseVersion: version } })
  expect(res.status(), await res.text()).toBe(200)
}

const fromMenu = async (page: Page, item: string) => {
  await page.getByRole('button', { name: 'Acciones de la página' }).click()
  await page.getByRole('menuitem', { name: item }).click()
}
const read = async (download: Download) => readFile((await download.path())!)

test('a page downloads as Markdown, alone or in a ZIP with its files and subpages, and prints alone on white', async ({ page, browserName }, testInfo) => {
  const workspaceId = await openNewWorkspace(page, 'Descargar E2E')
  const project = (await (await page.request.post(`/api/workspaces/${workspaceId}/projects`, { data: { name: 'Mudanza' } })).json()) as { id: string }
  const create = async (title: string, parentId: string | null = null) => ((await (await page.request.post(`/api/projects/${project.id}/pages`, { data: { title, parentId } })).json()) as { id: string }).id
  const plan = await create('Plan de mudanza')
  const list = await create('Inventario', plan)
  const photo = (await (await page.request.post(`/api/pages/${plan}/attachments`, { data: PIXEL, headers: { 'Content-Type': 'image/png', 'X-File-Name': encodeURIComponent('salón.png') } })).json()) as { id: string }
  await writePage(
    page,
    plan,
    `Lista para el **sábado**.\n\n![Salón](/api/attachments/${photo.id})\n\n| Caja | Habitación |\n| --- | --- |\n| Libros | Salón |\n\n- [x] Pedir cajas\n- [ ] Furgoneta\n\n\`\`\`sh\necho hola\n\`\`\`\n\nVer [el inventario](/doc/${list}) y [la web](https://example.com/mudanza).`,
  )

  await page.goto(`/w/${workspaceId}/d/${plan}`)
  await expect(page.getByRole('textbox', { name: 'Título de la página' })).toHaveValue('Plan de mudanza')

  // With subpages, it asks whether to take them; taken, they go in a folder, and the files next to the page.
  await fromMenu(page, 'Descargar en Markdown')
  const ask = page.getByRole('dialog', { name: 'Descargar «Plan de mudanza»' })
  await expect(ask).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('1-pregunta.png') })
  const zipped = page.waitForEvent('download')
  await ask.getByRole('button', { name: 'Con sus subpáginas' }).click()
  const zip = await zipped
  expect(zip.suggestedFilename()).toBe('Plan de mudanza.zip')
  const files = unzip(await read(zip))
  expect(Object.keys(files).sort()).toEqual(['Plan de mudanza (files)/salón.png', 'Plan de mudanza.md', 'Plan de mudanza/Inventario.md'])
  expect(files['Plan de mudanza.md']).toContain('![Salón](Plan%20de%20mudanza%20%28files%29/sal%C3%B3n.png)')
  expect(files['Plan de mudanza.md']).toContain('[el inventario](Plan%20de%20mudanza/Inventario.md)')
  expect(files['Plan de mudanza.md']).toContain('[la web](https://example.com/mudanza)')
  await expect(ask).toBeHidden()

  // A page that is only text comes as Markdown, with what was just written in it: it is saved first.
  await page.goto(`/w/${workspaceId}/d/${list}`)
  const editor = page.locator('.orq-prose[contenteditable="true"]')
  await editor.click()
  await page.keyboard.type('Pendiente: las lámparas.')
  const alone = page.waitForEvent('download')
  await fromMenu(page, 'Descargar en Markdown')
  const md = await alone
  expect(md.suggestedFilename()).toBe('Inventario.md')
  expect((await read(md)).toString('utf8')).toBe('Pendiente: las lámparas.')

  // Printing (or saving as PDF) gives the page alone, dark on white, each link with its address.
  await page.goto(`/w/${workspaceId}/d/${plan}`)
  await expect(page.getByRole('img', { name: 'Salón' })).toBeVisible()
  await page.evaluate(() => {
    window.print = () => {}
  })
  await fromMenu(page, 'Imprimir o guardar en PDF')
  await page.emulateMedia({ media: 'print', colorScheme: 'dark' })
  const printed = page.locator('.orq-print')
  await expect(printed).toBeVisible()
  await expect(printed.getByRole('heading', { level: 1, name: 'Plan de mudanza' })).toBeVisible()
  await expect(printed.getByRole('img', { name: 'Salón' })).toBeVisible()
  await expect(printed.locator('table')).toBeVisible()
  const sidebar = page.getByRole('navigation', { name: 'Navegación principal' })
  await expect(sidebar).toBeHidden()
  await expect(page.getByRole('button', { name: 'Acciones de la página' })).toBeHidden()
  // What follows each link on paper; Firefox and Safari give it in pieces ("(" "https://…" ")"), Chromium in one.
  const address = async (name: string) =>
    (await printed.getByRole('link', { name }).evaluate((a) => getComputedStyle(a, '::after').content)).replace(/"\s*"/g, '').replace(/^"|"$/g, '')
  expect(await address('la web')).toBe(' (https://example.com/mudanza)')
  expect(await address('el inventario')).toBe(` (${new URL(`/doc/${list}`, page.url()).href})`)
  // Dark on white, though the screen is dark.
  expect(await printed.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(28, 26, 22)')
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(255, 255, 255)')
  // A done task keeps its tick on paper, where backgrounds are left out unless the page asks for them.
  const adjust = await printed.locator('input[type="checkbox"]').first().evaluate((box) => {
    const style = getComputedStyle(box)
    return style.getPropertyValue('print-color-adjust') || style.getPropertyValue('-webkit-print-color-adjust')
  })
  expect(adjust).toBe('exact')
  await page.screenshot({ path: testInfo.outputPath('2-impresion.png'), fullPage: true })
  if (browserName === 'chromium') await page.pdf({ path: testInfo.outputPath('pagina.pdf') })

  // Done printing, the page is as it was; printing from the browser's own menu (Ctrl+P) prints it the same way.
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect(page.locator('.orq-print-root')).toHaveCount(0)
  await expect(page.locator('html')).not.toHaveClass(/orq-printing/)
  // Printing anything else prints the app as before.
  await expect(sidebar).toBeVisible()
  await page.emulateMedia({ media: 'screen', colorScheme: 'light' })
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
  await page.emulateMedia({ media: 'print' })
  await expect(printed.getByRole('heading', { level: 1, name: 'Plan de mudanza' })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect(page.locator('.orq-print-root')).toHaveCount(0)
})
