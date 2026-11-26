import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from './helpers'

/** A workspace with a board and a card, and an agent's access to it, made before the app opens. */
async function setup(page: Page, name: string) {
  const created = async (path: string, data: unknown) => {
    const res = await page.request.post(path, { data })
    expect(res.status(), await res.text()).toBe(201)
    return (await res.json()) as { id: string; token?: string }
  }
  const workspaceId = (await created('/api/workspaces', { name })).id
  const projectId = (await created(`/api/workspaces/${workspaceId}/projects`, { name: 'Mudanza' })).id
  const boardId = (await created(`/api/projects/${projectId}/boards`, { name: 'Tareas', columns: ['Por hacer'] })).id
  const board = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string }> }
  const cardId = (await created(`/api/columns/${board.columns[0]!.id}/cards`, { title: 'Contratar la furgoneta' })).id
  const { token } = await created('/api/tokens', { name: 'Claude', workspaceId, scopes: ['tasks:read', 'tasks:write', 'organize'], expiresInDays: 30 })
  return { workspaceId, boardId, cardId, token: token! }
}

/** What an agent writes, over the same API its MCP tools use. */
const agentComments = (request: APIRequestContext, baseURL: string, token: string, cardId: string, body: string) =>
  request.post(`${baseURL}/api/cards/${cardId}/comments`, { headers: { Authorization: `Bearer ${token}` }, data: { body } })

test('comments on a card: written, edited, live from an agent, deleted to the trash and back', async ({ page, request, baseURL }) => {
  const { workspaceId, boardId, cardId, token } = await setup(page, 'Comentarios E2E')
  await page.goto(`/w/${workspaceId}/b/${boardId}`)
  await page.getByRole('button', { name: 'Contratar la furgoneta' }).click()
  const sheet = page.getByRole('dialog')
  const list = sheet.getByRole('list', { name: 'Comentarios' })
  await expect(sheet.getByText('Aún no hay comentarios.', { exact: false })).toBeVisible()

  // Written with Markdown, sent with Ctrl+Enter.
  const box = sheet.getByRole('textbox', { name: 'Nuevo comentario' })
  await box.click()
  await page.keyboard.type('Pedir presupuesto a **dos empresas** ')
  await page.keyboard.press('ControlOrMeta+Enter')
  const mine = list.getByRole('listitem').filter({ hasText: 'Pedir presupuesto a dos empresas' })
  await expect(mine).toBeVisible()
  await expect(mine.locator('strong')).toHaveText('dos empresas')
  await expect(sheet.getByText('Comentarios · 1')).toBeVisible()
  // The box is empty again and keeps the focus, ready for the next one: Ctrl+Enter left no line break.
  await expect(box).toHaveText('')
  await expect(box).toBeFocused()
  await expect(box.locator('br:not(.ProseMirror-trailingBreak)')).toHaveCount(0)

  // An agent's comment shows up by itself, signed with its name.
  expect((await agentComments(request, baseURL!, token, cardId, 'He comparado tres presupuestos: el más barato es de **320 €**.')).status()).toBe(201)
  const theirs = list.getByRole('listitem').filter({ hasText: 'He comparado tres presupuestos' })
  await expect(theirs).toBeVisible()
  await expect(theirs).toContainText('Claude')
  await expect(theirs).toContainText('vía MCP')
  await expect(sheet.getByText('Comentarios · 2')).toBeVisible()
  // Newest first.
  await expect(list.getByRole('listitem').first()).toContainText('He comparado tres presupuestos')

  // Its words are not the person's to change: only to delete.
  await theirs.getByRole('button', { name: 'Acciones del comentario' }).click()
  await expect(page.getByRole('menuitem', { name: 'Eliminar' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Editar' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // The person's own: edited, and marked so.
  await mine.getByRole('button', { name: 'Acciones del comentario' }).click()
  await page.getByRole('menuitem', { name: 'Editar' }).click()
  const editor = sheet.getByRole('textbox', { name: 'Editar el comentario' })
  await expect(editor).toBeFocused()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('Pedir presupuesto a tres empresas')
  await sheet.getByRole('button', { name: 'Guardar' }).click()
  const edited = list.getByRole('listitem').filter({ hasText: 'Pedir presupuesto a tres empresas' })
  await expect(edited).toBeVisible()
  await expect(edited).toContainText('(editado)')
  // The focus goes back to the comment's menu, not to the top of the sheet.
  await expect(edited.getByRole('button', { name: /Acciones del comentario/ })).toBeFocused()

  // The agent's, deleted to the trash, and back from where it was, by keyboard too.
  await theirs.getByRole('button', { name: 'Acciones del comentario' }).click()
  await page.getByRole('menuitem', { name: 'Eliminar' }).click()
  await expect(theirs).toHaveCount(0)
  await expect(sheet.getByText('Comentarios · 1')).toBeVisible()
  const removed = sheet.getByRole('status').filter({ hasText: 'Comentario movido a la papelera' })
  await expect(removed.getByRole('button', { name: 'Deshacer' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(theirs).toBeVisible()
  await expect(sheet.getByText('Comentarios · 2')).toBeVisible()
  await expect(removed).toHaveCount(0)

  // What is written and not sent waits for the card to open again, also when it is closed with Escape.
  await box.click()
  await page.keyboard.type('Un borrador sin enviar')
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await page.getByRole('button', { name: 'Contratar la furgoneta' }).click()
  await expect(sheet.getByRole('textbox', { name: 'Nuevo comentario' })).toHaveText('Un borrador sin enviar')
  await page.keyboard.press('Escape')

  // The board counts them on the card.
  await expect(sheet).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Columna Por hacer' }).getByTitle('Comentarios')).toHaveText('2')
})

test('on a phone, a comment is written with the button and earlier ones come on request', async ({ page, request, baseURL }) => {
  const { cardId, token } = await setup(page, 'Comentarios móvil E2E')
  // More than a page of them, so the earlier ones wait.
  // Each in a millisecond of its own, so their order is that of their numbers.
  for (let i = 1; i <= 52; i++) {
    expect((await agentComments(request, baseURL!, token, cardId, `Paso ${i}`)).status()).toBe(201)
    await new Promise((resolve) => setTimeout(resolve, 3))
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/card/${cardId}`)
  const sheet = page.getByRole('dialog')
  const list = sheet.getByRole('list', { name: 'Comentarios' })
  await expect(list.getByRole('listitem')).toHaveCount(50)
  await expect(list.getByRole('listitem').first()).toContainText('Paso 52')
  await sheet.getByRole('button', { name: 'Ver comentarios anteriores' }).click()
  await expect(list.getByRole('listitem')).toHaveCount(52)
  await expect(list.getByRole('listitem').last()).toContainText('Paso 1')
  await expect(sheet.getByRole('button', { name: 'Ver comentarios anteriores' })).toHaveCount(0)

  await sheet.getByRole('textbox', { name: 'Nuevo comentario' }).click()
  await page.keyboard.type('Visto desde el móvil')
  await sheet.getByRole('button', { name: 'Comentar', exact: true }).click()
  await expect(list.getByRole('listitem').first()).toContainText('Visto desde el móvil')
  await expect(sheet.getByText('Comentarios · 53')).toBeVisible()
})

// A comment that ends in a list, opened to be edited: left as it was, it is not kept as an edit in
// progress when the card closes, and the cursor is at its end. The empty line the editor keeps
// after the list came with the cursor: it counted as an edit, and in Safari it threw ("Applying a
// mismatched transaction").
test('a comment that ends in a list is edited from its end, and left as it was is not kept in edition', async ({ page }) => {
  const { workspaceId, boardId, cardId } = await setup(page, 'Comentarios edición E2E')
  const posted = await page.request.post(`/api/cards/${cardId}/comments`, { data: { body: 'Lo que falta:\n\n- cajas\n- cinta' } })
  expect(posted.status(), await posted.text()).toBe(201)
  await page.goto(`/w/${workspaceId}/b/${boardId}`)
  const card = page.getByRole('button', { name: 'Contratar la furgoneta' })
  await card.click()
  const sheet = page.getByRole('dialog')
  const comment = sheet.getByRole('list', { name: 'Comentarios' }).getByRole('listitem').filter({ hasText: 'Lo que falta' })
  const edit = async () => {
    await comment.getByRole('button', { name: 'Acciones del comentario' }).click()
    await page.getByRole('menuitem', { name: 'Editar' }).click()
    await expect(editor).toBeFocused()
  }
  const editor = sheet.getByRole('textbox', { name: 'Editar el comentario' })
  await edit()
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await card.click()
  await expect(comment.getByText('cinta')).toBeVisible()
  await expect(editor).toHaveCount(0)

  await edit()
  await page.keyboard.type(' y tijeras')
  await sheet.getByRole('button', { name: 'Guardar' }).click()
  await expect(editor).toHaveCount(0)
  await expect(comment.getByRole('listitem').last()).toHaveText('cinta y tijeras')
})

test('Ctrl+Enter from a formula’s or a caption’s field sends what was typed in it, as the button does', async ({ page }) => {
  const { workspaceId, boardId, cardId } = await setup(page, 'Comentarios campos E2E')
  // A picture of the card's own, made in the browser, in a comment to edit.
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 240
    canvas.height = 120
    const context = canvas.getContext('2d')!
    context.fillStyle = '#3b82f6'
    context.fillRect(0, 0, 240, 120)
    return canvas.toDataURL('image/png').split(',')[1]!
  })
  const uploaded = await page.request.post(`/api/cards/${cardId}/attachments`, { headers: { 'Content-Type': 'image/png', 'X-File-Name': 'plano.png' }, data: Buffer.from(png, 'base64') })
  expect(uploaded.status(), await uploaded.text()).toBe(201)
  const src = ((await uploaded.json()) as { url: string }).url
  const posted = await page.request.post(`/api/cards/${cardId}/comments`, { data: { body: `Plano\n\n![plano](${src})` } })
  expect(posted.status(), await posted.text()).toBe(201)
  const bodies = async () => ((await (await page.request.get(`/api/cards/${cardId}/comments`)).json()) as { comments: Array<{ body: string }> }).comments.map((c) => c.body.trim())
  await page.goto(`/w/${workspaceId}/b/${boardId}`)
  await page.getByRole('button', { name: 'Contratar la furgoneta' }).click()
  const sheet = page.getByRole('dialog', { name: 'Contratar la furgoneta' })
  const formulaField = page.getByRole('dialog', { name: 'Editar fórmula' }).getByRole('textbox', { name: 'Fórmula en LaTeX' })

  // A new comment, sent from its formula's field: with the formula as it was just changed.
  const box = sheet.getByRole('textbox', { name: 'Nuevo comentario' })
  await box.click()
  await page.keyboard.type('Coste $$x$$ ')
  await box.locator('.orq-math .katex-html').click()
  await expect(formulaField).toBeFocused()
  await formulaField.fill('y^2')
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect.poll(bodies).toContain('Coste $y^2$')
  // The box, empty, for the next one.
  await expect(box).toBeFocused()
  await expect(box.locator('.orq-math')).toHaveCount(0)

  // The same, with the button.
  await page.keyboard.type('Peso $$m$$ ')
  await box.locator('.orq-math .katex-html').click()
  await formulaField.fill('m_0')
  await sheet.getByRole('button', { name: 'Comentar', exact: true }).click()
  await expect.poll(bodies).toContain('Peso $m_0$')

  // A comment edited, saved from its image's caption: with the caption.
  const plan = sheet.getByRole('list', { name: 'Comentarios' }).getByRole('listitem').filter({ hasText: 'Plano' })
  await plan.getByRole('button', { name: 'Acciones del comentario' }).click()
  await page.getByRole('menuitem', { name: 'Editar' }).click()
  const editor = sheet.getByRole('textbox', { name: 'Editar el comentario' })
  await editor.locator('.orq-image img').click()
  await page.getByRole('toolbar', { name: 'Imagen' }).getByRole('button', { name: 'Pie de imagen' }).click()
  const caption = page.getByRole('textbox', { name: 'Pie de imagen' })
  await expect(caption).toBeFocused()
  await caption.fill('Planta baja')
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(editor).toHaveCount(0)
  await expect.poll(bodies).toContain(`Plano\n\n![plano](${src} "Planta baja")`)
  await expect(plan.locator('.orq-image-caption')).toHaveText('Planta baja')
})
