import { createProject, expect, openNewWorkspace, test } from './helpers'

// A project's Documents are as wide as its Boards, with «New page» on the same right edge; empty,
// they look like empty Boards, and «Recently edited» comes below once there are pages.
test('a project shows its documents as wide as its boards, and the recent ones below', async ({ page }) => {
  await openNewWorkspace(page, 'Proyecto E2E')
  await createProject(page, 'VideoMonta')
  // Opened from the sidebar, as people do: loading anew while the board's requests are on their
  // way makes WebKit report them as refused.
  const project = page.getByRole('navigation').getByRole('link', { name: 'V VideoMonta', exact: true })
  await project.click()
  await page.waitForURL(/\/p\/[0-9a-f-]{36}$/)

  const section = (name: string) => page.locator('section').filter({ has: page.getByRole('heading', { level: 2, name, exact: true }) })
  const boards = section('Tableros')
  const docs = section('Documentos')
  await expect(docs).toBeVisible()
  const same = async () => {
    const [b, d] = [await boards.boundingBox(), await docs.boundingBox()]
    expect(d!.width).toBeCloseTo(b!.width, 0)
    const [newBoard, newPage] = [await boards.getByRole('button', { name: 'Nuevo tablero' }).boundingBox(), await docs.getByRole('button', { name: 'Nueva página' }).boundingBox()]
    expect(newPage!.x + newPage!.width).toBeCloseTo(newBoard!.x + newBoard!.width, 0)
  }
  await same()
  await expect(section('Editado recientemente')).toHaveCount(0)

  // Empty, the whole box writes the first page.
  await docs.getByRole('button', { name: /Escribe una página para documentar este proyecto/ }).click()
  await page.waitForURL(/\/d\/[0-9a-f-]{36}/)
  await expect(page.locator('.orq-prose')).toBeVisible()
  await project.click()
  await page.waitForURL(/\/p\/[0-9a-f-]{36}$/)
  await expect(docs.getByRole('link')).toHaveCount(1)
  const recent = section('Editado recientemente')
  await expect(recent.getByRole('link')).toHaveCount(1)
  await same()
  expect((await recent.boundingBox())!.width).toBeCloseTo((await boards.boundingBox())!.width, 0)
  expect((await recent.boundingBox())!.y).toBeGreaterThan((await docs.boundingBox())!.y)
})
