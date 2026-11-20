import { addCard, createProject, expect, openNewWorkspace, test } from './helpers'

// From the history, people undo what an agent did (one change, or everything since a point),
// are told when someone changed the same thing since, and can put back an earlier version.
test('undo an agent’s changes from the history, and put back an earlier version', async ({ page, request, baseURL }) => {
  const workspaceId = await openNewWorkspace(page, 'Deshacer E2E')
  const boardId = await createProject(page, 'Lanzamiento')
  await addCard(page, 'Por hacer', 'Preparar la nota de prensa')
  const board = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { projectId: string; columns: Array<{ id: string; name: string }>; cards: Array<{ id: string }> }
  const cardId = board.cards[0]!.id
  const doc = (await (await page.request.post(`/api/projects/${board.projectId}/pages`, { data: { title: 'Notas', content: 'Uno' } })).json()) as { id: string }
  const created = await page.request.post('/api/tokens', {
    data: { name: 'Claude', workspaceId, scopes: ['tasks:read', 'tasks:write', 'docs:read', 'docs:write'], expiresInDays: null },
  })
  const { token } = (await created.json()) as { token: string }
  const asAgent = async (method: 'patch' | 'post', path: string, data: unknown) => {
    const res = await request[method](`${baseURL}/api${path}`, { headers: { Authorization: `Bearer ${token}` }, data })
    expect(res.status(), await res.text()).toBe(200)
    return res.json()
  }
  const pageNow = async () => (await (await page.request.get(`/api/pages/${doc.id}`)).json()) as { content: string; version: number }

  // The agent renames and moves the card and rewrites the notes; then a person edits the notes too.
  await asAgent('patch', `/cards/${cardId}`, { title: 'Nota de prensa (borrador IA)' })
  await asAgent('post', `/cards/${cardId}/move`, { columnId: board.columns.find((c) => c.name === 'En curso')!.id, index: 0 })
  await asAgent('patch', `/pages/${doc.id}`, { content: 'Uno\n\nDos', baseVersion: (await pageNow()).version })
  await page.request.patch(`/api/pages/${doc.id}`, { data: { content: 'Uno\n\nDos\n\nTres', baseVersion: (await pageNow()).version } })

  // Everything the agent did since renaming the card: the notes are skipped, as a person changed them since.
  await page.getByRole('button', { name: 'Nota de prensa (borrador IA)' }).click()
  await page.getByRole('button', { name: 'Acciones de la tarjeta' }).click()
  await page.getByRole('menuitem', { name: 'Historial' }).click()
  const history = page.getByRole('dialog', { name: /^Historial de/ })
  const renamed = history.getByRole('listitem').filter({ hasText: 'Claude le cambió el nombre' })
  await renamed.getByRole('button', { name: 'Deshacer todo lo que hizo Claude desde aquí' }).click()
  const confirm = page.getByRole('dialog', { name: '¿Deshacer 3 cambios de Claude?' })
  await expect(confirm.getByRole('list', { name: 'Cambiados después' })).toContainText('«Notas»: lo cambió después Lucía Martín')
  // The agent keeps working meanwhile: what it does now isn't among the changes shown, and stays.
  const made = await request.post(`${baseURL}/api/columns/${board.columns[0]!.id}/cards`, { headers: { Authorization: `Bearer ${token}` }, data: { title: 'Llegó después' } })
  expect(made.status(), await made.text()).toBe(201)
  const later = (await made.json()) as { id: string }
  await confirm.getByRole('button', { name: 'Deshacer 2 y saltar el resto' }).click()
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Se han deshecho 2 cambios' })
  await expect(toast).toContainText('Se ha saltado 1 cambio que se tocó después.')
  await expect(history.getByRole('listitem').first()).toContainText('deshace un cambio anterior')
  await expect(history.getByRole('listitem').filter({ hasText: 'Lucía Martín le cambió el nombre de «Nota de prensa (borrador IA)» a «Preparar la nota de prensa»' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Título de la tarjeta')).toHaveValue('Preparar la nota de prensa')
  const card = (await (await page.request.get(`/api/cards/${cardId}`)).json()) as { columnId: string }
  expect(card.columnId).toBe(board.columns.find((c) => c.name === 'Por hacer')!.id)
  expect((await pageNow()).content).toBe('Uno\n\nDos\n\nTres')
  expect((await page.request.get(`/api/cards/${later.id}`)).status()).toBe(200)

  // One change someone changed since: it asks first, and cancelling leaves it.
  // Opened from the sidebar, as people do: loading the page anew while the board's requests are on
  // their way makes WebKit report them as refused.
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Título de la tarjeta')).toHaveCount(0)
  await page.getByRole('navigation').getByRole('link', { name: 'Notas' }).click()
  await page.waitForURL(`**/d/${doc.id}`)
  await page.getByRole('button', { name: 'Acciones de la página' }).click()
  await page.getByRole('menuitem', { name: 'Historial' }).click()
  const pageHistory = page.getByRole('dialog', { name: 'Historial de «Notas»' })
  await pageHistory.getByRole('listitem').filter({ hasText: 'Claude editó el contenido' }).getByRole('button', { name: 'Deshacer', exact: true }).click()
  const asked = page.getByRole('dialog', { name: 'Alguien lo cambió después' })
  await expect(asked).toContainText('Lucía Martín lo cambió después de este cambio.')
  await asked.getByRole('button', { name: 'Cancelar' }).click()
  await expect(asked).toHaveCount(0)
  expect((await pageNow()).content).toBe('Uno\n\nDos\n\nTres')

  // An earlier version comes back as a new change, and the open page shows it.
  const first = pageHistory.getByRole('listitem').filter({ hasText: 'Lucía Martín editó el contenido' }).last()
  await first.getByRole('button', { name: 'Ver qué cambió' }).click()
  await first.getByRole('button', { name: 'Restaurar esta versión' }).click()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Versión restaurada' })).toBeVisible()
  await expect(pageHistory.getByRole('listitem').first()).toContainText('restaura una versión anterior')
  await page.keyboard.press('Escape')
  await expect(page.locator('.orq-prose')).toHaveText('Uno')
  expect((await pageNow()).content).toBe('Uno')
})

// Live updates can be down for a moment: restoring a version still shows it in the open page.
test('a restored version shows in the open page even when live updates are down', async ({ page, request, baseURL }) => {
  // Live updates never connect: the page only has what it asks for.
  await page.routeWebSocket(/\/live$/, () => {})
  const workspaceId = await openNewWorkspace(page, 'Sin directo E2E')
  await createProject(page, 'Diario')
  const created = await page.request.post('/api/tokens', { data: { name: 'Claude', workspaceId, scopes: ['docs:read', 'docs:write'], expiresInDays: null } })
  const { token } = (await created.json()) as { token: string }

  await page.getByRole('button', { name: 'Nueva página en Diario' }).click({ force: true })
  await page.waitForURL(/\/d\//)
  const pageId = page.url().split('/d/')[1]!
  await page.getByLabel('Título de la página').fill('Semana')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Lunes')
  await expect(page.getByText('Guardado')).toBeVisible()
  // The agent writes twice; with no live updates, the open page doesn't know.
  for (const content of ['Lunes\n\nMartes', 'Lunes\n\nMiércoles']) {
    const { version } = (await (await page.request.get(`/api/pages/${pageId}`)).json()) as { version: number }
    const res = await request.patch(`${baseURL}/api/pages/${pageId}`, { headers: { Authorization: `Bearer ${token}` }, data: { content, baseVersion: version } })
    expect(res.status(), await res.text()).toBe(200)
  }
  await expect(page.locator('.orq-prose')).toHaveText('Lunes')

  await page.getByRole('button', { name: 'Acciones de la página' }).click()
  await page.getByRole('menuitem', { name: 'Historial' }).click()
  const martes = page.getByRole('dialog', { name: 'Historial de «Semana»' }).getByRole('listitem').filter({ hasText: 'Claude editó el contenido' }).last()
  await martes.getByRole('button', { name: 'Ver qué cambió' }).click()
  await martes.getByRole('button', { name: 'Restaurar esta versión' }).click()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Versión restaurada' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.orq-prose')).toContainText('Martes')
  await expect(page.locator('.orq-prose')).not.toContainText('Miércoles')
})

// Undoing a change someone changed since, anyway, also shows in the open page when live updates are down.
test('a forced undo shows in the open page even when live updates are down', async ({ page, request, baseURL }) => {
  await page.routeWebSocket(/\/live$/, () => {})
  // Everything is made first, so the page opens with nothing on its way.
  const workspace = (await (await page.request.post('/api/workspaces', { data: { name: 'Forzar sin directo E2E' } })).json()) as { id: string }
  const project = (await (await page.request.post(`/api/workspaces/${workspace.id}/projects`, { data: { name: 'Notas' } })).json()) as { id: string }
  const doc = (await (await page.request.post(`/api/projects/${project.id}/pages`, { data: { title: 'Plan', content: 'Uno' } })).json()) as { id: string }
  const created = await page.request.post('/api/tokens', { data: { name: 'Claude', workspaceId: workspace.id, scopes: ['docs:read', 'docs:write'], expiresInDays: null } })
  const { token } = (await created.json()) as { token: string }
  const res = await request.patch(`${baseURL}/api/pages/${doc.id}`, { headers: { Authorization: `Bearer ${token}` }, data: { content: 'Uno\n\nDos', baseVersion: 1 } })
  expect(res.status(), await res.text()).toBe(200)

  // The person opens the page, with the agent's text, and writes after it.
  await page.goto(`/w/${workspace.id}/d/${doc.id}`)
  await expect(page.locator('.orq-prose')).toContainText('Dos')
  await page.locator('.orq-prose p').last().click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Tres')
  await expect(page.getByText('Guardado')).toBeVisible()

  // Undoing the agent's change anyway takes the page back to before it, and the open page shows it.
  await page.getByRole('button', { name: 'Acciones de la página' }).click()
  await page.getByRole('menuitem', { name: 'Historial' }).click()
  const history = page.getByRole('dialog', { name: 'Historial de «Plan»' })
  await history.getByRole('listitem').filter({ hasText: 'Claude editó el contenido' }).getByRole('button', { name: 'Deshacer', exact: true }).click()
  const asked = page.getByRole('dialog', { name: 'Alguien lo cambió después' })
  await asked.getByRole('button', { name: 'Deshacer igualmente' }).click()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Cambio deshecho' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.orq-prose')).toHaveText('Uno')
})

// More than 500 changes go back in batches, each shown first, and the change chosen is never left
// out; what has no history (columns here) is listed as not undone, with its place in the trash.
test('undoing everything an agent did goes in batches and says what it leaves as it is', async ({ page, request, baseURL }) => {
  const workspaceId = await openNewWorkspace(page, 'Tandas E2E')
  const boardId = await createProject(page, 'Inventario')
  await addCard(page, 'Por hacer', 'Contar el almacén')
  const board = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string; name: string }>; cards: Array<{ id: string }> }
  const cardId = board.cards[0]!.id
  const created = (await (await page.request.post('/api/tokens', { data: { name: 'Claude', workspaceId, scopes: ['tasks:read', 'tasks:write'], expiresInDays: null } })).json()) as { id: string; token: string }
  expect((await page.request.patch(`/api/tokens/${created.id}`, { data: { organize: true } })).status()).toBe(200)
  const asAgent = async (method: 'patch' | 'post' | 'delete', path: string, data?: unknown) => {
    const res = await request[method](`${baseURL}/api${path}`, { headers: { Authorization: `Bearer ${created.token}` }, data })
    expect(res.ok(), await res.text()).toBe(true)
    return res.json()
  }

  // 503 changes: a new name, a card with a checklist and 500 items; and two columns.
  await asAgent('patch', `/cards/${cardId}`, { title: 'Contar el almacén (IA)' })
  const other = (await asAgent('post', `/columns/${board.columns[0]!.id}/cards`, { title: 'Recuento' })) as { id: string }
  const list = (await asAgent('post', `/cards/${other.id}/checklists`, { title: 'Estantes' })) as { id: string }
  for (let start = 0; start < 500; start += 25) await Promise.all(Array.from({ length: 25 }, (_, i) => asAgent('post', `/checklists/${list.id}/items`, { text: `Estante ${start + i + 1}` })))
  await asAgent('post', `/boards/${boardId}/columns`, { name: 'Revisión' })
  const done = board.columns.find((c) => c.name === 'Hecho')!
  await asAgent('delete', `/columns/${done.id}`)

  await page.reload()
  await page.getByRole('button', { name: 'Contar el almacén (IA)' }).click()
  await page.getByRole('button', { name: 'Acciones de la tarjeta' }).click()
  await page.getByRole('menuitem', { name: 'Historial' }).click()
  const history = page.getByRole('dialog', { name: /^Historial de/ })
  await history.getByRole('listitem').filter({ hasText: 'Claude le cambió el nombre' }).getByRole('button', { name: 'Deshacer todo lo que hizo Claude desde aquí' }).click()

  // The newest 500 first: the rest, the change chosen among them, wait for the next batch.
  const first = page.getByRole('dialog', { name: '¿Deshacer 500 cambios de Claude?' })
  await expect(first.getByRole('status')).toHaveText('Se deshacen hasta 500 cambios cada vez. Quedan 3 más antiguos, entre ellos el que elegiste: se muestran al terminar esta tanda.')
  const left = first.getByRole('list', { name: 'No se deshacen aquí' })
  await expect(left.getByRole('listitem')).toHaveText(['Columna «Revisión»: creada', 'Columna «Hecho»: borrada Abrir en la papelera'])
  await expect(left.getByRole('link', { name: 'Abrir en la papelera' })).toHaveAttribute('href', `/w/${workspaceId}/trash?item=${encodeURIComponent(`column:${done.id}`)}`)
  await first.getByRole('button', { name: 'Deshacer 500 cambios' }).click()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Se han deshecho 500 cambios' })).toBeVisible()

  const second = page.getByRole('dialog', { name: '¿Deshacer 3 cambios de Claude?' })
  await expect(second.getByRole('status')).toHaveText('Ya se han deshecho 500 cambios; esta es la tanda siguiente.')
  await expect(second.getByRole('list', { name: 'Cambiados después' })).toHaveCount(0)
  await second.getByRole('button', { name: 'Deshacer 3 cambios' }).click()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Se han deshecho 3 cambios' })).toBeVisible()
  await expect(second).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Título de la tarjeta')).toHaveValue('Contar el almacén')
  expect((await page.request.get(`/api/cards/${other.id}`)).status()).toBe(404)
  // The columns stay as the agent left them.
  const now = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ name: string }> }
  expect(now.columns.map((c) => c.name)).toEqual(['Por hacer', 'En curso', 'Revisión'])
})

// A batch where everything was changed since by someone else can be left as it is, to go on with
// the older changes, the one chosen among them.
test('a batch where everything was changed since can be left, to go on with the older ones', async ({ page, request, baseURL }) => {
  const workspaceId = await openNewWorkspace(page, 'Tanda en conflicto E2E')
  const boardId = await createProject(page, 'Almacén')
  await addCard(page, 'Por hacer', 'Revisar estantes')
  const board = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string }>; cards: Array<{ id: string }> }
  const created = (await (await page.request.post('/api/tokens', { data: { name: 'Claude', workspaceId, scopes: ['tasks:read', 'tasks:write'], expiresInDays: null } })).json()) as { token: string }
  const asAgent = async (method: 'patch' | 'post', path: string, data?: unknown) => {
    const res = await request[method](`${baseURL}/api${path}`, { headers: { Authorization: `Bearer ${created.token}` }, data })
    expect(res.ok(), await res.text()).toBe(true)
    return res.json()
  }
  // The agent renames the card and fills another with 500 items; a person then edits every item.
  await asAgent('patch', `/cards/${board.cards[0]!.id}`, { title: 'Revisar estantes (IA)' })
  const other = (await asAgent('post', `/columns/${board.columns[0]!.id}/cards`, { title: 'Recuento' })) as { id: string }
  const list = (await asAgent('post', `/cards/${other.id}/checklists`, { title: 'Estantes' })) as { id: string }
  const items: string[] = []
  for (let start = 0; start < 500; start += 25) {
    const made = await Promise.all(Array.from({ length: 25 }, (_, i) => asAgent('post', `/checklists/${list.id}/items`, { text: `Estante ${start + i + 1}` }) as Promise<{ id: string }>))
    items.push(...made.map((m) => m.id))
  }
  for (let start = 0; start < items.length; start += 25) {
    await Promise.all(items.slice(start, start + 25).map(async (id) => expect((await page.request.patch(`/api/checklist-items/${id}`, { data: { done: true } })).ok()).toBe(true)))
  }

  await page.reload()
  await page.getByRole('button', { name: 'Revisar estantes (IA)' }).click()
  await page.getByRole('button', { name: 'Acciones de la tarjeta' }).click()
  await page.getByRole('menuitem', { name: 'Historial' }).click()
  await page.getByRole('dialog', { name: /^Historial de/ }).getByRole('listitem').filter({ hasText: 'Claude le cambió el nombre' }).getByRole('button', { name: 'Deshacer todo lo que hizo Claude desde aquí' }).click()

  // All 500 were changed since: nothing to undo without losing that, so it goes on to the older ones.
  const first = page.getByRole('dialog', { name: '¿Deshacer 500 cambios de Claude?' })
  await expect(first.getByRole('list', { name: 'Cambiados después' }).getByRole('listitem')).toHaveCount(500)
  await first.getByRole('button', { name: 'Ver los 3 anteriores' }).click()

  const second = page.getByRole('dialog', { name: '¿Deshacer 3 cambios de Claude?' })
  await expect(second.getByRole('status')).toHaveCount(0)
  await second.getByRole('button', { name: 'Deshacer 1 y saltar el resto' }).click()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Cambio deshecho' })).toContainText('Se han saltado 2 cambios que se tocaron después.')
  await expect(second).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Título de la tarjeta')).toHaveValue('Revisar estantes')
  // What the person worked on stays.
  const kept = (await (await page.request.get(`/api/cards/${other.id}`)).json()) as { checklists: Array<{ items: Array<{ done: boolean }> }> }
  expect(kept.checklists[0]!.items.filter((i) => i.done)).toHaveLength(500)
})
