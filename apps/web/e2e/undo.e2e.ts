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
