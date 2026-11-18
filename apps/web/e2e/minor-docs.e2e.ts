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
