import { addCard, createProject, expect, openNewWorkspace, test } from './helpers'

// Files dropped together onto a document go in in the order they were dropped.
test('files dropped together keep their order in the document', async ({ page }, testInfo) => {
  await openNewWorkspace(page, 'Soltar E2E')
  await createProject(page, 'Manuales')
  await page.getByRole('button', { name: 'Nueva página en Manuales' }).click({ force: true })
  await page.waitForURL(/\/d\//)
  await page.getByLabel('Título de la página').fill('Anexos')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Los anexos van aquí.')
  const prose = page.locator('.orq-prose')
  const box = (await prose.getByText('Los anexos van aquí.').boundingBox())!

  await prose.evaluate((editor, at) => {
    const data = new DataTransfer()
    for (const name of ['uno.txt', 'dos.txt', 'tres.txt']) data.items.add(new File([name], name, { type: 'text/plain' }))
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
    // Firefox drops the dataTransfer given to the constructor of a synthetic event, so set it on the event.
    Object.defineProperty(drop, 'dataTransfer', { value: data })
    editor.dispatchEvent(drop)
  }, { x: box.x + box.width - 2, y: box.y + box.height / 2 })

  const links = prose.getByRole('link')
  await expect(links).toHaveText(['uno.txt', 'dos.txt', 'tres.txt'])
  await prose.screenshot({ path: testInfo.outputPath('1-en-el-orden-en-que-se-soltaron.png'), animations: 'disabled' })
})

// Attaching several files to a card: one that can't go up says so, and the rest still do.
test('one file that fails does not stop the others attached with it', async ({ page }, testInfo) => {
  await openNewWorkspace(page, 'Varios E2E')
  await createProject(page, 'Entregas')
  await addCard(page, 'Por hacer', 'Enviar los planos')
  await page.getByRole('button', { name: 'Enviar los planos' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Adjuntar archivo' }).click()
  await (await chooser).setFiles([
    { name: 'enorme.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(21 * 1024 * 1024) },
    { name: 'planos.txt', mimeType: 'text/plain', buffer: Buffer.from('Planos') },
  ])
  await expect(page.getByText('enorme.bin: El archivo supera el tamaño máximo permitido.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'planos.txt', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('2-uno-falla-y-el-otro-se-adjunta.png'), animations: 'disabled' })
})

// Deleting a project that the server can't delete says so.
test('a delete that fails says so', async ({ page, consoleErrors }) => {
  await openNewWorkspace(page, 'Borrar E2E')
  await createProject(page, 'Indeleble')
  await page.getByRole('navigation').getByRole('link', { name: 'Indeleble', exact: true }).click()
  await page.route('**/api/projects/*', (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Internal error' } }) })
      : route.fallback(),
  )
  await page.getByRole('button', { name: 'Eliminar proyecto' }).click()
  await page.getByRole('dialog', { name: '¿Eliminar el proyecto «Indeleble»?' }).getByRole('button', { name: 'Eliminar proyecto' }).click()
  await expect(page.getByText('Algo ha fallado en el servidor. Inténtalo de nuevo.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Indeleble' })).toBeVisible()
  const refused = /status of 500/
  consoleErrors.splice(0, consoleErrors.length, ...consoleErrors.filter((e) => !refused.test(e)))
})

// Several files dropped on a page: the one that can't go up is named, and /Image offers AVIF.
test('a file that fails among several dropped on a page is named, and the image picker takes AVIF', async ({ page }, testInfo) => {
  await openNewWorkspace(page, 'Fallos E2E')
  await createProject(page, 'Informes')
  await page.getByRole('button', { name: 'Nueva página en Informes' }).click({ force: true })
  await page.waitForURL(/\/d\//)
  await page.getByLabel('Título de la página').fill('Anexos')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Los anexos van aquí.')
  const prose = page.locator('.orq-prose')
  const box = (await prose.getByText('Los anexos van aquí.').boundingBox())!
  await prose.evaluate((editor, at) => {
    const data = new DataTransfer()
    data.items.add(new File(['bien'], 'bien.txt', { type: 'text/plain' }))
    data.items.add(new File([new Uint8Array(21 * 1024 * 1024)], 'enorme.bin', { type: 'application/octet-stream' }))
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
    Object.defineProperty(drop, 'dataTransfer', { value: data })
    editor.dispatchEvent(drop)
  }, { x: box.x + box.width - 2, y: box.y + box.height / 2 })
  await expect(page.getByText('enorme.bin: El archivo supera el tamaño máximo permitido.')).toBeVisible()
  await expect(prose.getByRole('link', { name: 'bien.txt' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('2-el-que-falla-con-su-nombre.png'), animations: 'disabled' })

  await prose.getByText('Los anexos van aquí.').click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/imagen')
  await expect(page.getByText('Sube PNG, JPG, GIF, WebP o AVIF')).toBeVisible()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('option', { name: /Imagen/ }).click()
  const accept = await (await chooser).element().getAttribute('accept')
  expect(accept?.split(',')).toContain('image/avif')
})

// A page full of emoji, under the limit as the server counts it, saves from the editor.
test('a page full of emoji that the server takes can be saved from the editor', async ({ page }) => {
  await openNewWorkspace(page, 'Emoji E2E')
  const boardId = await createProject(page, 'Emojis')
  const { projectId } = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { projectId: string }
  // 101,000 emoji in 101 paragraphs: 101,200 characters, over 200,000 UTF-16 units.
  const content = Array.from({ length: 101 }, () => '🦤'.repeat(1000)).join('\n\n')
  const created = await page.request.post(`/api/projects/${projectId}/pages`, { data: { title: 'Pájaros', content } })
  expect(created.status()).toBe(201)
  const { id } = (await created.json()) as { id: string }
  await page.getByRole('navigation').getByRole('link', { name: 'Pájaros' }).click()
  await page.waitForURL(new RegExp(`/d/${id}`))
  const prose = page.locator('.orq-prose')
  await expect(prose.locator('p').first()).toBeVisible()
  await prose.locator('p').last().click()
  // To the end of the page: End alone stops at the end of the line on screen.
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(' fin')
  await expect(page.getByText('Guardado')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/Este documento tiene .* caracteres/)).toHaveCount(0)
  await expect.poll(async () => ((await (await page.request.get(`/api/pages/${id}`)).json()) as { content: string }).content.endsWith(' fin')).toBe(true)
})

// A link to a card or a page deleted for good says so, instead of landing at home without a word.
test('a link to a card or a page deleted for good says it no longer exists', async ({ page, consoleErrors }, testInfo) => {
  const workspaceId = await openNewWorkspace(page, 'Borrados E2E')
  const boardId = await createProject(page, 'Pasado')
  const board = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { projectId: string; columns: Array<{ id: string }> }
  const card = (await (await page.request.post(`/api/columns/${board.columns[0]!.id}/cards`, { data: { title: 'Tarjeta olvidada' } })).json()) as { id: string }
  const doc = (await (await page.request.post(`/api/projects/${board.projectId}/pages`, { data: { title: 'Página olvidada' } })).json()) as { id: string }
  expect((await page.request.delete(`/api/cards/${card.id}`)).ok()).toBe(true)
  expect((await page.request.delete(`/api/pages/${doc.id}`)).ok()).toBe(true)
  for (const key of [`card:${card.id}`, `page:${doc.id}`]) {
    expect((await page.request.delete(`/api/workspaces/${workspaceId}/trash/${encodeURIComponent(key)}`)).ok()).toBe(true)
  }
  const visit = async (path: string) => {
    // In the app, as a link in a document does: a new load here races the requests still in flight in WebKit.
    await page.evaluate((to) => {
      window.history.pushState(null, '', to)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, path)
  }
  await visit(`/card/${card.id}`)
  await expect(page.getByRole('heading', { name: 'Esta tarjeta ya no existe' })).toBeVisible()
  await expect(page.getByText('Se borró para siempre o está en un espacio al que no tienes acceso.')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('3-tarjeta-que-ya-no-existe.png'), animations: 'disabled' })
  await page.getByRole('button', { name: 'Volver al inicio' }).click()
  await expect(page.getByRole('button', { name: 'Nuevo proyecto' }).first()).toBeVisible()
  await visit(`/doc/${doc.id}`)
  await expect(page.getByRole('heading', { name: 'Esta página ya no existe' })).toBeVisible()
  // Asking for them is how the app learns they are gone.
  const gone = /status of 404/
  consoleErrors.splice(0, consoleErrors.length, ...consoleErrors.filter((e) => !gone.test(e)))
})
