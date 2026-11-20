import { addCard, createProject, expect, openNewWorkspace, settle, test } from './helpers'

// What people delete goes to the trash: they can undo it at once, bring it back later from the
// trash where it was, with its place if that is in the trash too, or delete it for good.
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

  // Restored, it goes back to its column, and says where.
  await truck.getByRole('button', { name: 'Restaurar «Contratar camión»' }).click()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Se ha restaurado «Contratar camión»' })).toContainText('Está en Mudanza › Tareas › Por hacer.')
  await expect(truck).toHaveCount(0)
  const board = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string; name: string }>; cards: Array<{ title: string; columnId: string }> }
  const todo = board.columns.find((c) => c.name === 'Por hacer')!
  expect(board.cards.find((c) => c.title === 'Contratar camión')?.columnId).toBe(todo.id)

  // Its column deleted after, the card deleted before waits inside it: never anywhere else.
  expect((await page.request.delete(`/api/columns/${todo.id}`)).status()).toBe(200)
  const column1 = list.getByRole('listitem', { name: 'Por hacer' })
  await expect(column1).toContainText('Columna · Mudanza › Tareas · 2 tarjetas')
  await expect(list.getByRole('listitem', { name: 'Embalar libros' })).toHaveCount(0)
  await column1.getByRole('button', { name: 'Mostrar lo que contiene «Por hacer»' }).click()
  const inside = column1.getByRole('list', { name: 'Dentro de «Por hacer»' })
  const books = inside.getByRole('listitem', { name: 'Embalar libros' })
  await expect(books).toContainText('Borrado antes')
  await expect(inside.getByRole('listitem', { name: 'Contratar camión' })).not.toContainText('Borrado antes')

  // Restoring it asks where: its column comes back with it, and only it.
  await books.getByRole('button', { name: 'Restaurar «Embalar libros»' }).click()
  const dialog = page.getByRole('dialog', { name: 'Restaurar «Embalar libros»' })
  await expect(dialog).toContainText('Lo que lo contenía también está en la papelera.')
  await expect(dialog.getByRole('radio', { name: 'Recrear su sitio' })).toBeChecked()
  await expect(dialog).toContainText('Vuelve también la columna «Por hacer», y solo eso: lo demás que contienen se queda en la papelera.')
  await expect(dialog).toContainText('Irá a Mudanza › Tareas › Por hacer')
  await dialog.getByRole('button', { name: 'Restaurar', exact: true }).click()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Se ha restaurado «Embalar libros»' })).toContainText('Está en Mudanza › Tareas › Por hacer.')
  const after = (await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string; name: string }>; cards: Array<{ title: string; columnId: string }> }
  expect(after.columns.map((c) => c.name)).toEqual(['Por hacer', 'En curso', 'Hecho'])
  expect(after.cards.map((c) => [c.title, c.columnId])).toEqual([['Embalar libros', todo.id]])
  // What it held besides stays in the trash, now straight back to its place.
  await expect(list.getByRole('listitem', { name: 'Contratar camión' })).toContainText('Tarjeta · Mudanza › Tareas › Por hacer')

  // A checklist item deleted before its checklist: restored, its checklist comes back with it.
  const card = (await (await page.request.post(`/api/columns/${board.columns[1]!.id}/cards`, { data: { title: 'Revisar inventario' } })).json()) as { id: string }
  const checklist = (await (await page.request.post(`/api/cards/${card.id}/checklists`, { data: { title: 'Pasos' } })).json()) as { id: string }
  const item = (await (await page.request.post(`/api/checklists/${checklist.id}/items`, { data: { text: 'Contar cajas' } })).json()) as { id: string }
  await page.request.post(`/api/checklists/${checklist.id}/items`, { data: { text: 'Cerrar cajas' } })
  expect((await page.request.delete(`/api/checklist-items/${item.id}`)).status()).toBe(200)
  expect((await page.request.delete(`/api/checklists/${checklist.id}`)).status()).toBe(200)
  const steps = list.getByRole('listitem', { name: 'Pasos' })
  await expect(steps).toContainText('Checklist · Mudanza › Tareas › Revisar inventario · 2 puntos de checklist')
  await steps.getByRole('button', { name: 'Mostrar lo que contiene «Pasos»' }).click()
  await steps.getByRole('listitem', { name: 'Contar cajas' }).getByRole('button', { name: 'Restaurar «Contar cajas»' }).click()
  const second = page.getByRole('dialog', { name: 'Restaurar «Contar cajas»' })
  await expect(second).toContainText('Vuelve también la checklist «Pasos», y solo eso')
  await second.getByRole('button', { name: 'Restaurar', exact: true }).click()
  await expect(page.getByText('Se ha restaurado «Contar cajas»')).toBeVisible()
  const restored = (await (await page.request.get(`/api/cards/${card.id}`)).json()) as { checklists: Array<{ title: string; items: Array<{ text: string }> }> }
  expect(restored.checklists.map((c) => [c.title, c.items.map((i) => i.text)])).toEqual([['Pasos', ['Contar cajas']]])
  // The rest of the checklist's deletion stays: its other item, now at the top.
  await expect(list.getByRole('listitem', { name: 'Cerrar cajas' })).toBeVisible()

  // Deleting for good asks first, says what goes with it, and leaves nothing to restore.
  expect((await page.request.delete(`/api/columns/${todo.id}`)).status()).toBe(200)
  const column2 = list.getByRole('listitem', { name: 'Por hacer' })
  await column2.getByRole('button', { name: 'Borrar «Por hacer» para siempre' }).click()
  const purge = page.getByRole('dialog', { name: '¿Borrar «Por hacer» para siempre?' })
  await expect(purge).toContainText('Con todo lo que contiene: 2 tarjetas. Incluye también lo que se borró antes por separado: 1 tarjeta. Después no se podrá recuperar.')
  await purge.getByRole('button', { name: 'Borrar para siempre' }).click()
  await expect(column2).toHaveCount(0)
  await expect(list.getByRole('listitem', { name: 'Contratar camión' })).toHaveCount(0)
  await list.getByRole('listitem', { name: 'Cerrar cajas' }).getByRole('button', { name: 'Borrar «Cerrar cajas» para siempre' }).click()
  await page.getByRole('dialog', { name: '¿Borrar «Cerrar cajas» para siempre?' }).getByRole('button', { name: 'Borrar para siempre' }).click()
  await expect(page.getByRole('heading', { name: 'La papelera está vacía' })).toBeVisible()

  // The refused restore and the failed delete are expected; some browsers log every 4xx and 5xx answer as an error.
  consoleErrors.splice(0, consoleErrors.length, ...consoleErrors.filter((e) => !/status of (409 \(Conflict\)|500 \(Internal Server Error\))/.test(e)))
})
