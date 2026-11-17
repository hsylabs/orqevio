import { addCard, createProject, expect, openNewWorkspace, settle, test } from './helpers'

// What people delete goes to the trash: they can undo it at once, bring it back later from
// the trash, wherever it still fits, or delete it for good.
test('deleted things wait in the trash, to undo, restore or delete for good', async ({ page, baseURL, consoleErrors }) => {
  const workspaceId = await openNewWorkspace(page, 'Papelera E2E')
  const boardId = await createProject(page, 'Mudanza')
  await addCard(page, 'Por hacer', 'Contratar camión')
  await addCard(page, 'Por hacer', 'Embalar libros')
  const column = page.getByRole('region', { name: 'Columna Por hacer' })

  // Deleting a card says where it went, and "Deshacer" brings it back.
  const deleteCard = async (title: string) => {
    await column.getByRole('button', { name: title }).click()
    await page.getByRole('button', { name: 'Acciones de la tarjeta' }).click()
    await page.getByRole('menuitem', { name: 'Eliminar' }).click()
    const dialog = page.getByRole('dialog', { name: '¿Eliminar esta tarjeta?' })
    await expect(dialog).toContainText('Irá a la papelera con su checklist y adjuntos.')
    await expect(dialog).toContainText('Podrás recuperarlo todo desde la papelera durante 30 días.')
    await dialog.getByRole('button', { name: 'Eliminar' }).click()
    await expect(column.getByRole('button', { name: title })).toHaveCount(0)
  }
  // Another tab has the card open: it says the card is gone, then shows it again once it's back.
  const cards = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { cards: Array<{ id: string; title: string }> }
  const truckId = cards.cards.find((c) => c.title === 'Contratar camión')!.id
  const other = await page.context().newPage()
  await settle(other, baseURL!)
  await other.goto(`/w/${workspaceId}/b/${boardId}?card=${truckId}`)
  await expect(other.getByRole('button', { name: 'Acciones de la tarjeta' })).toBeVisible()

  await deleteCard('Contratar camión')
  await expect(other.getByText('Esta tarjeta ya no existe')).toBeVisible()
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Tarjeta movida a la papelera' })
  await expect(toast).toContainText('Está en la papelera, por si cambias de idea.')
  await toast.getByRole('button', { name: 'Deshacer' }).click()
  await expect(column.getByRole('button', { name: 'Contratar camión' })).toBeVisible()
  await expect(other.getByRole('button', { name: 'Acciones de la tarjeta' })).toBeVisible()
  await expect(other.getByText('Esta tarjeta ya no existe')).toHaveCount(0)
  await other.close()

  // A delete that fails leaves the card as it was: deleted later elsewhere, its open sheet says it is gone.
  const failing = (route: import('@playwright/test').Route) =>
    route.request().method() === 'DELETE' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"internal","message":"x"}}' }) : route.continue()
  await page.route(`**/api/cards/${truckId}`, failing)
  await column.getByRole('button', { name: 'Contratar camión' }).click()
  await page.getByRole('button', { name: 'Acciones de la tarjeta' }).click()
  await page.getByRole('menuitem', { name: 'Eliminar' }).click()
  await page.getByRole('dialog', { name: '¿Eliminar esta tarjeta?' }).getByRole('button', { name: 'Eliminar' }).click()
  await expect(page.getByText('Algo ha fallado en el servidor. Inténtalo de nuevo.')).toBeVisible()
  await page.unroute(`**/api/cards/${truckId}`, failing)
  await column.getByRole('button', { name: 'Contratar camión' }).click()
  await expect(page.getByRole('button', { name: 'Acciones de la tarjeta' })).toBeVisible()
  const elsewhere = (await (await page.request.delete(`/api/cards/${truckId}`)).json()) as { trashId: string }
  await expect(page.getByText('Esta tarjeta ya no existe')).toBeVisible()
  expect((await page.request.post(`/api/trash/${elsewhere.trashId}/restore`)).status()).toBe(200)
  await page.keyboard.press('Escape')
  await expect(column.getByRole('button', { name: 'Contratar camión' })).toBeVisible()

  // In the trash: what it is, where it was and who deleted it.
  await deleteCard('Contratar camión')
  await deleteCard('Embalar libros')
  await page.getByRole('navigation').getByRole('link', { name: 'Papelera' }).click()
  await expect(page).toHaveURL(`/w/${workspaceId}/trash`)
  const list = page.getByRole('list', { name: 'Papelera' })
  const truck = list.getByRole('listitem', { name: 'Contratar camión' })
  await expect(truck).toContainText('Tarjeta · Mudanza › Tareas › Por hacer')
  await expect(truck).toContainText('Borrado por Lucía Martín')
  await expect(truck).toContainText('Se borrará para siempre dentro de 30 días')

  // Restored, it goes back to its column; with the column gone, to the first one, and says so.
  await truck.getByRole('button', { name: 'Restaurar' }).click()
  await expect(page.getByText('Se ha restaurado «Contratar camión»')).toBeVisible()
  await expect(truck).toHaveCount(0)
  const board = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string; name: string }>; cards: Array<{ title: string; columnId: string }> }
  const todo = board.columns.find((c) => c.name === 'Por hacer')!
  expect(board.cards.find((c) => c.title === 'Contratar camión')?.columnId).toBe(todo.id)
  expect((await page.request.delete(`/api/columns/${todo.id}`)).status()).toBe(200)
  // The column shows up at the top of the list a moment later, moving the rest down: wait for it,
  // as people do, so the click doesn't land on its button instead.
  await expect(list.getByRole('listitem', { name: 'Por hacer' })).toBeVisible()
  await list.getByRole('listitem', { name: 'Embalar libros' }).getByRole('button', { name: 'Restaurar' }).click()
  await expect(page.getByText('Su sitio ya no existe, así que ahora está en Mudanza › Tareas › En curso.')).toBeVisible()

  // Something whose place is in the trash too asks to restore that first.
  await expect(list.getByRole('listitem', { name: 'Por hacer' })).toContainText('Columna · Mudanza › Tareas · 1 tarjeta')
  const card = (await (await page.request.post(`/api/columns/${board.columns[1]!.id}/cards`, { data: { title: 'Revisar inventario' } })).json()) as { id: string }
  const checklist = (await (await page.request.post(`/api/cards/${card.id}/checklists`, { data: { title: 'Pasos' } })).json()) as { id: string }
  const item = (await (await page.request.post(`/api/checklists/${checklist.id}/items`, { data: { text: 'Contar cajas' } })).json()) as { id: string }
  expect((await page.request.delete(`/api/checklist-items/${item.id}`)).status()).toBe(200)
  expect((await page.request.delete(`/api/checklists/${checklist.id}`)).status()).toBe(200)
  const contar = list.getByRole('listitem', { name: 'Contar cajas' })
  await expect(list.getByRole('listitem', { name: 'Pasos' })).toBeVisible()
  await contar.getByRole('button', { name: 'Restaurar' }).click()
  await expect(page.getByText('Restaura antes «Pasos»: aquello a lo que pertenece también está en la papelera.')).toBeVisible()
  await expect(contar).toBeVisible()

  // Deleting for good asks first, and leaves nothing to restore.
  for (const name of ['Contar cajas', 'Pasos', 'Por hacer']) {
    await list.getByRole('listitem', { name }).getByRole('button', { name: `Borrar «${name}» para siempre` }).click()
    const dialog = page.getByRole('dialog', { name: `¿Borrar «${name}» para siempre?` })
    await expect(dialog).toContainText('Después no se podrá recuperar.')
    await dialog.getByRole('button', { name: 'Borrar para siempre' }).click()
    await expect(list.getByRole('listitem', { name })).toHaveCount(0)
  }
  await expect(page.getByRole('heading', { name: 'La papelera está vacía' })).toBeVisible()

  // The refused restore and the failed delete are expected; some browsers log every 4xx and 5xx answer as an error.
  consoleErrors.splice(0, consoleErrors.length, ...consoleErrors.filter((e) => !/status of (409 \(Conflict\)|500 \(Internal Server Error\))/.test(e)))
})
