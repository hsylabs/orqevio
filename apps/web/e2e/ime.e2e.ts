import type { Locator, Page } from '@playwright/test'
import { addCard, createProject, expect, openNewWorkspace, test } from './helpers'

type Style = 'composing' | 'safari'
const STYLES: Style[] = ['composing', 'safari']

/**
 * Writes `text` into the focused field as an input method does, and presses `key` as part of the
 * conversion: marked as composing, as Chrome and Firefox send it, or once the conversion has ended
 * and marked only by its key code, as Safari sends the Enter that accepts it.
 */
async function convert(page: Page, text: string, key: 'Enter' | 'Escape', style: Style) {
  const send = (step: 'start' | 'key' | 'end') =>
    page.evaluate(
      ({ step, key, text, style }) => {
        const field = document.activeElement!
        if (step === 'start') field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
        if (step === 'end') field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text }))
        if (step === 'key') {
          const event = new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true, isComposing: style === 'composing' })
          Object.defineProperty(event, 'keyCode', { get: () => 229 })
          field.dispatchEvent(event)
        }
      },
      { step, key, text, style },
    )
  await send('start')
  await page.keyboard.insertText(text)
  if (style === 'safari') await send('end')
  await send('key')
  if (style === 'composing') await send('end')
}

const focused = (field: Locator) => field.evaluate((el) => el === document.activeElement)

test('the Enter or Escape that ends a conversion stays in the field: cards, columns and checklists', async ({ page }) => {
  await openNewWorkspace(page, 'Teclado japonés E2E')
  await createProject(page, '引っ越し')
  const todo = page.getByRole('region', { name: 'Columna Por hacer' })

  // A new card: the Enter that accepts the conversion does not add it; the next one does.
  for (const style of STYLES) {
    await page.getByRole('button', { name: 'Añadir tarjeta a Por hacer' }).click()
    const title = todo.getByLabel('Título de la tarjeta')
    await convert(page, `見積書 ${style}`, 'Enter', style)
    await expect(title).toHaveValue(`見積書 ${style}`)
    await expect(todo.getByRole('button', { name: `見積書 ${style}` })).toHaveCount(0)
    await convert(page, 'を比較', 'Escape', style)
    await expect(title).toHaveValue(`見積書 ${style}を比較`)
    await page.keyboard.press('Enter')
    await expect(todo.getByRole('button', { name: `見積書 ${style}を比較` })).toBeVisible()
    await page.keyboard.press('Escape')
  }

  // Renaming a column: neither key ends the renaming; Enter and Escape, typed outside a conversion, do.
  for (const style of STYLES) {
    await page.getByRole('button', { name: 'Acciones de Por hacer' }).click()
    await page.getByRole('menuitem', { name: 'Renombrar' }).click()
    const name = page.getByLabel('Nombre de la columna')
    await name.press('End')
    await convert(page, '中', 'Enter', style)
    await convert(page, '止', 'Escape', style)
    await expect(name).toBeVisible()
    expect(await focused(name)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(name).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Columna Por hacer' })).toBeVisible()
  }

  // The title of a card in its sheet, and a new checklist item.
  await addCard(page, 'Por hacer', '書類')
  await page.getByRole('button', { name: '書類' }).click()
  const cardTitle = page.getByRole('dialog').getByLabel('Título de la tarjeta')
  for (const style of STYLES) {
    await cardTitle.click()
    await cardTitle.press('End')
    await convert(page, '確認', 'Enter', style)
    expect(await focused(cardTitle)).toBe(true)
  }
  await expect(cardTitle).toHaveValue('書類確認確認')
  await page.keyboard.press('Enter')
  expect(await focused(cardTitle)).toBe(false)
  // The sheet keeps the board out of reach while it is open: closed, the board shows the new title.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(todo.getByRole('button', { name: '書類確認確認' })).toBeVisible()
  await todo.getByRole('button', { name: '書類確認確認' }).click()

  await page.getByRole('button', { name: '+ Añadir' }).click()
  await page.getByRole('button', { name: 'Añadir elemento' }).click()
  const item = page.getByLabel('Nuevo elemento')
  // The sheet closes on Escape anywhere in it, but not on the one that drops a conversion.
  for (const style of STYLES) {
    await convert(page, '印鑑', 'Escape', style)
    await expect(item).toBeVisible()
    await expect(page.getByRole('dialog')).toBeVisible()
  }
  await page.keyboard.press('Enter')
  await expect(page.getByRole('checkbox', { name: '印鑑印鑑' })).toBeVisible()

  // Editing an item: neither key of a conversion saves the edit or drops it.
  await page.getByRole('button', { name: '印鑑印鑑', exact: true }).click()
  const edit = page.getByLabel('Elemento', { exact: true })
  await edit.press('End')
  for (const style of STYLES) {
    await convert(page, '済', 'Enter', style)
    await convert(page, '済', 'Escape', style)
    await expect(edit).toBeVisible()
  }
  await page.keyboard.press('Enter')
  await expect(page.getByRole('checkbox', { name: '印鑑印鑑済済済済' })).toBeVisible()

  // A popover (the name of a new label) closes on Escape, but not on the one of a conversion.
  await page.getByRole('button', { name: 'Añadir etiquetas' }).click()
  await page.getByRole('button', { name: 'Crear etiqueta' }).click()
  const labelName = page.getByLabel('Nombre de la etiqueta')
  for (const style of STYLES) {
    await convert(page, '至急', 'Escape', style)
    await expect(labelName).toBeVisible()
  }
  await page.keyboard.press('Escape')
  await expect(labelName).toHaveCount(0)
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('the Enter that ends a conversion stays in the title of a page, and its Escape in a dialog', async ({ page }) => {
  await openNewWorkspace(page, 'Teclado japonés páginas E2E')

  // The command palette closes on Escape, but not on the one that drops a conversion in its search.
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Paleta de comandos' })
  await expect(palette).toBeVisible()
  for (const style of STYLES) {
    await convert(page, '計画', 'Escape', style)
    await expect(palette).toBeVisible()
  }
  await page.keyboard.press('Escape')
  await expect(palette).toHaveCount(0)

  // A dialog closes on Escape, but not on the one that drops a conversion in its field.
  await page.getByRole('button', { name: 'Nuevo proyecto' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Nombre').click()
  for (const style of STYLES) {
    await convert(page, '計', 'Escape', style)
    await expect(dialog).toBeVisible()
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  await createProject(page, '計画')
  await page.getByRole('button', { name: 'Nueva página en 計画' }).click({ force: true })
  await page.waitForURL(/\/d\//)
  const title = page.getByLabel('Título de la página')
  await title.click()
  for (const style of STYLES) {
    await convert(page, '議事録', 'Enter', style)
    expect(await focused(title)).toBe(true)
  }
  await expect(title).toHaveValue('議事録議事録')
  await page.keyboard.press('Enter')
  expect(await focused(title)).toBe(false)
  await page.keyboard.type('本文')
  await expect(page.locator('.ProseMirror')).toContainText('本文')
  await expect(title).toHaveValue('議事録議事録')
})
