import { addCard, createProject, expect, openNewWorkspace, test } from './helpers'

test('write a document that references a task', async ({ page }) => {
  await openNewWorkspace(page, 'Documentos E2E')
  await createProject(page, 'Producto')
  await addCard(page, 'Por hacer', 'Investigar a la competencia')

  await page.getByRole('button', { name: 'Nueva página en Producto' }).click({ force: true })
  await page.waitForURL(/\/d\//)
  await page.getByLabel('Título de la página').fill('Plan de producto')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/título 2')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Contexto')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Ver @Investigar')
  await expect(page.getByRole('option', { name: /Investigar a la competencia/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await page.keyboard.type('antes de decidir.')
  await expect(page.getByText('Guardado')).toBeVisible()

  // The reference created a link that both sides show.
  await expect(page.getByLabel('Tareas vinculadas').getByText('Investigar a la competencia')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { level: 2, name: 'Contexto' })).toBeVisible()
  await expect(page.locator('.orq-prose a[href^="/card/"]')).toHaveText('Investigar a la competencia')

  const pageId = page.url().split('/d/')[1]!
  const markdown = await page.evaluate(async (id) => (await (await fetch(`/api/pages/${id}`)).json()).content as string, pageId)
  expect(markdown).toMatch(/^## Contexto/m)
  expect(markdown).toMatch(/\[Investigar a la competencia\]\(\/card\/[0-9a-f-]{36}\)/)

  // Clicking the reference opens the card on its board.
  await page.locator('.orq-prose a[href^="/card/"]').click()
  await page.waitForURL(/\/b\/.+\?card=/)
  await expect(page.getByLabel('Título de la tarjeta')).toHaveValue('Investigar a la competencia')
  await expect(page.getByRole('link', { name: 'Plan de producto' })).toBeVisible()
})
