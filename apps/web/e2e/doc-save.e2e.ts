import type { Page, WebSocketRoute } from '@playwright/test'
import { createProject, expect, openNewWorkspace, settle, test } from './helpers'

/** Opens a new page of the project from the sidebar, gives it a title and a first line, and waits for it to be saved. */
async function newDoc(page: Page, project: string, title: string, text: string) {
  await page.getByRole('button', { name: `Nueva página en ${project}` }).click({ force: true })
  await page.waitForURL(/\/d\//)
  await page.getByLabel('Título de la página').fill(title)
  await page.keyboard.press('Enter')
  await page.keyboard.type(text)
  await expect(page.getByText('Guardado')).toBeVisible()
  return { url: page.url(), id: page.url().split('/d/')[1]! }
}

/** Times of the attempts to save the body of the page (titles are saved apart). */
function contentSaves(page: Page, pageId: string) {
  const at: number[] = []
  page.on('request', (r) => {
    if (r.method() === 'PATCH' && r.url().endsWith(`/api/pages/${pageId}`) && r.postData()?.includes('"content"')) at.push(Date.now())
  })
  return at
}

const content = async (page: Page, pageId: string) => ((await (await page.request.get(`/api/pages/${pageId}`)).json()) as { content: string }).content

test('a document too long to save says so once, sends nothing, and saves again once shortened', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await openNewWorkspace(page, 'Documento largo E2E')
  await createProject(page, 'Archivo')
  const doc = await newDoc(page, 'Archivo', 'Registro', 'Inicio')
  const saves = contentSaves(page, doc.id)

  await page.keyboard.insertText('a'.repeat(200_000))
  const banner = page.getByRole('alert').filter({ hasText: 'Este documento tiene 200.006 caracteres y el máximo es 200.000.' })
  await expect(banner).toContainText('Acórtalo para que se pueda guardar: hasta entonces, tus cambios no se guardan.')
  // Before, it sent it every 0.4 s, and each refusal showed another error.
  await page.waitForTimeout(2500)
  expect(saves).toEqual([])
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('1-documento-demasiado-largo.png'), animations: 'disabled' })

  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Corto')
  await expect(page.getByText('Guardado')).toBeVisible()
  await expect(banner).toBeHidden()
  expect(await content(page, doc.id)).toBe('Corto')
})

test('a page deleted in another tab says so at once, keeps what was written and comes back with «Restaurar»', async ({ page, context, baseURL }, testInfo) => {
  test.setTimeout(90_000)
  await openNewWorkspace(page, 'Página borrada E2E')
  await createProject(page, 'Manual')
  const doc = await newDoc(page, 'Manual', 'Guía', 'Primera parte.')
  const saves = contentSaves(page, doc.id)

  const other = await context.newPage()
  try {
    await settle(other, baseURL!)
    await other.goto(doc.url)
    await other.getByRole('button', { name: 'Acciones de la página' }).click()
    await other.getByRole('menuitem', { name: 'Eliminar página' }).click()
    await other.getByRole('dialog').getByRole('button', { name: 'Eliminar página' }).click()
    await other.waitForURL(/\/p\//)
  } finally {
    await other.close()
  }

  const banner = page.getByRole('alert').filter({ hasText: 'Has borrado esta página en otra pestaña o sesión.' })
  await expect(banner).toContainText('Está en la papelera.')
  // What is written now stays in the editor; nothing is sent while the page is in the trash.
  await page.getByRole('textbox', { name: 'Contenido de la página' }).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(' Segunda parte.')
  await expect(banner).toContainText('Tus últimos cambios no se han guardado: se guardarán al restaurarla.')
  await page.waitForTimeout(1500)
  expect(saves).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('2-pagina-borrada-en-otra-pestana.png'), animations: 'disabled' })

  // Leaving would lose it: the app asks first.
  await page.getByRole('navigation').getByRole('link', { name: 'Papelera' }).click()
  const leave = page.getByRole('dialog', { name: '¿Salir sin guardar?' })
  await expect(leave).toContainText('Tus últimos cambios en esta página no se han guardado y se perderán.')
  await leave.getByRole('button', { name: 'Cancelar' }).click()
  await expect(leave).toBeHidden()
  expect(page.url()).toBe(doc.url)

  await banner.getByRole('button', { name: 'Restaurar' }).click()
  await expect(banner).toBeHidden()
  await expect(page.getByText('Guardado')).toBeVisible()
  expect(await content(page, doc.id)).toBe('Primera parte. Segunda parte.')
  // Writing goes on where it was.
  await expect(page.getByRole('textbox', { name: 'Contenido de la página' })).toBeFocused()
  await page.keyboard.type(' Tercera.')
  await expect.poll(() => content(page, doc.id)).toBe('Primera parte. Segunda parte. Tercera.')
  await expect(page.getByRole('navigation').getByRole('link', { name: /^Guía/ })).toBeVisible()
})

// Live events missed while disconnected: the page is read again on reconnecting, and found back.
test('a page restored elsewhere while this tab was disconnected comes back once it reconnects', async ({ page }) => {
  test.setTimeout(90_000)
  let deaf = false
  const sockets: WebSocketRoute[] = []
  await page.routeWebSocket(/\/live$/, (ws) => {
    sockets.push(ws)
    const server = ws.connectToServer()
    server.onMessage((message) => {
      if (!deaf) ws.send(message)
    })
  })
  await openNewWorkspace(page, 'Reconexión E2E')
  await createProject(page, 'Notas')
  const doc = await newDoc(page, 'Notas', 'Acta', 'Primer punto.')

  const deleted = await page.request.delete(`/api/pages/${doc.id}`)
  const { trashId } = (await deleted.json()) as { trashId: string }
  const banner = page.getByRole('alert').filter({ hasText: 'Has borrado esta página en otra pestaña o sesión.' })
  await expect(banner).toBeVisible()

  // Restored from elsewhere while this tab hears nothing.
  deaf = true
  expect((await page.request.post(`/api/trash/${trashId}/restore`)).status()).toBe(200)
  await page.waitForTimeout(1000)
  await expect(banner).toBeVisible()

  // The connection drops and comes back: the page is read again, and it is there.
  deaf = false
  await sockets.at(-1)!.close()
  await expect(banner).toBeHidden({ timeout: 20_000 })
  await page.getByRole('textbox', { name: 'Contenido de la página' }).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(' Segundo punto.')
  await expect.poll(() => content(page, doc.id)).toBe('Primer punto. Segundo punto.')
})

test('without a connection the editor waits longer each time, warns once, and saves when it is back', async ({ page, context, consoleErrors }, testInfo) => {
  test.setTimeout(90_000)
  await openNewWorkspace(page, 'Sin red E2E')
  await createProject(page, 'Viaje')
  const doc = await newDoc(page, 'Viaje', 'Diario', 'Antes.')
  const saves = contentSaves(page, doc.id)

  await context.setOffline(true)
  await page.keyboard.type(' Sin red.')
  const banner = page.getByRole('alert').filter({ hasText: 'No se han podido guardar tus últimos cambios.' })
  await expect(banner).toContainText('No hay conexión con el servidor. Se volverá a intentar automáticamente.')
  const first = saves[0]!
  await page.waitForTimeout(5000)
  // Waits of 1, 2 and 4 s: before, an attempt every 0.4 s, each with an error of its own.
  const gaps = saves.slice(1).map((at, i) => at - saves[i]!)
  expect(saves.length, `attempts ${saves.map((at) => at - first).join(', ')} ms`).toBeLessThanOrEqual(4)
  for (const [i, gap] of gaps.entries()) expect(gap).toBeGreaterThan(900 * 2 ** i)
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('3-sin-conexion.png'), animations: 'disabled' })

  await context.setOffline(false)
  await expect(page.getByText('Guardado')).toBeVisible({ timeout: 20_000 })
  await expect(banner).toBeHidden()
  expect(await content(page, doc.id)).toBe('Antes. Sin red.')

  // Every browser reports the requests that could not go out, each in its own words.
  const offline = /ERR_INTERNET_DISCONNECTED|NetworkError|network connection|Load failed|WebSocket|can’t establish a connection|Could not connect|WebKit encountered an internal error/i
  consoleErrors.splice(0, consoleErrors.length, ...consoleErrors.filter((e) => !offline.test(e)))
})
