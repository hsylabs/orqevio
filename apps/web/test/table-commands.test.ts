// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { TableMap } from '@tiptap/pm/tables'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import { documentExtensions } from '../src/features/docs/editor/markdown'
import {
  alignColumns,
  canMoveRow,
  deleteColumns,
  deleteRows,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  selectLine,
  spotOf,
} from '../src/features/docs/editor/table-commands'

// Each control changes the table the way its Markdown can say, and the result reads back the same.
const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))

const TABLE = ['| Fruta | Precio |', '| ----- | -----: |', '| Pera  | 2      |', '| Uva   | 3      |'].join('\n')

function open(markdown = TABLE) {
  const editor = new Editor({ extensions: documentExtensions(), content: markdown, contentType: 'markdown' })
  editors.push(editor)
  return editor
}

function tablePos(editor: Editor) {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === 'table') found = pos
    return found === -1
  })
  return found
}

/** The cursor in a cell, as a click would put it. */
function cursorAt(editor: Editor, row: number, col: number) {
  const pos = tablePos(editor)
  const table = editor.state.doc.nodeAt(pos)!
  const map = TableMap.get(table)
  const cell = pos + 1 + map.map[row * map.width + col]!
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(cell + 1))))
  return pos
}

/** The table as rows of cell texts, the header first. */
function cells(editor: Editor) {
  const rows: string[][] = []
  editor.state.doc.nodeAt(tablePos(editor))!.forEach((row) => {
    const texts: string[] = []
    row.forEach((cell) => texts.push(cell.textContent))
    rows.push(texts)
  })
  return rows
}

/** Saved and read again, it is the same: what the controls make is a table Markdown can hold. */
function expectStable(editor: Editor) {
  const markdown = editor.getMarkdown()
  const again = open(markdown)
  expect(again.getMarkdown()).toBe(markdown)
  expect(again.getJSON()).toEqual(editor.getJSON())
  return markdown
}

const type = (editor: Editor, text: string) => editor.commands.insertContent(text)

describe('table controls', () => {
  it('insert a row above or below, with the cursor in it', () => {
    const editor = open()
    const pos = cursorAt(editor, 1, 1)
    insertRow(editor, pos, 1, 1)
    type(editor, '1')
    insertRow(editor, pos, 4, 0)
    type(editor, 'Kiwi')
    expect(cells(editor)).toEqual([['Fruta', 'Precio'], ['', '1'], ['Pera', '2'], ['Uva', '3'], ['Kiwi', '']])
    // The new cells take their column's alignment, so they show it before the page is read again.
    const price = (row: number) => editor.state.doc.nodeAt(tablePos(editor))!.child(row).child(1).attrs.align
    expect([1, 4].map(price)).toEqual(['right', 'right'])
    expect(expectStable(editor)).toMatch(/\| -+ \| -+: \|/)
  })

  it('never inserts a row above the header row', () => {
    const editor = open()
    const pos = cursorAt(editor, 0, 0)
    expect(insertRow(editor, pos, 0)).toBe(false)
    expect(cells(editor)[0]).toEqual(['Fruta', 'Precio'])
  })

  it('insert a column to the left or right, with the cursor in it', () => {
    const editor = open()
    const pos = cursorAt(editor, 0, 0)
    insertColumn(editor, pos, 0, 0)
    type(editor, 'N.º')
    insertColumn(editor, pos, 3, 1)
    type(editor, 'sí')
    expect(cells(editor)).toEqual([['N.º', 'Fruta', 'Precio', ''], ['', 'Pera', '2', 'sí'], ['', 'Uva', '3', '']])
    // The header row is still all header, and the price is still to the right.
    const markdown = expectStable(editor)
    expect(markdown.split('\n').filter(Boolean)[1]).toMatch(/^\| -+ \| -+ \| -+: \| -+ \|$/)
  })

  it('move rows below the header, and columns anywhere', () => {
    const editor = open()
    const pos = cursorAt(editor, 1, 0)
    expect(moveRow(editor, pos, 2, 1)).toBe(true)
    expect(cells(editor).map((r) => r[0])).toEqual(['Fruta', 'Uva', 'Pera'])
    expect(moveColumn(editor, pos, 1, 0)).toBe(true)
    expect(cells(editor)).toEqual([['Precio', 'Fruta'], ['3', 'Uva'], ['2', 'Pera']])
    // The column takes its alignment with it.
    expect(expectStable(editor)).toMatch(/\| -+: \| -+ \|/)
  })

  it('keeps the header row first', () => {
    const editor = open()
    const pos = cursorAt(editor, 1, 0)
    expect(canMoveRow({ header: true, rows: 3 }, 1, 0)).toBe(false)
    expect(canMoveRow({ header: true, rows: 3 }, 0, 1)).toBe(false)
    expect(moveRow(editor, pos, 1, 0)).toBe(false)
    expect(moveRow(editor, pos, 0, 2)).toBe(false)
    expect(cells(editor)[0]).toEqual(['Fruta', 'Precio'])
  })

  it('delete rows and columns, never the last one', () => {
    const editor = open()
    const pos = cursorAt(editor, 1, 0)
    expect(deleteRows(editor, pos, 1, 2)).toBe(true)
    expect(deleteColumns(editor, pos, 0, 1)).toBe(true)
    expect(cells(editor)).toEqual([['Precio'], ['3']])
    expect(deleteColumns(editor, pos, 0, 1)).toBe(false)
    expect(deleteRows(editor, pos, 0, 2)).toBe(false)
    expectStable(editor)
  })

  it('makes the next row the header when the header row goes', () => {
    const editor = open()
    const pos = cursorAt(editor, 0, 0)
    expect(deleteRows(editor, pos, 0, 1)).toBe(true)
    expect(cells(editor)).toEqual([['Pera', '2'], ['Uva', '3']])
    expect(spotOf(editor.state)?.header).toBe(true)
    expect(expectStable(editor).split('\n').filter(Boolean)[0]).toMatch(/^\| Pera +\| 2 +\|$/)
  })

  it('aligns whole columns, and back to the left', () => {
    const editor = open()
    const pos = cursorAt(editor, 1, 0)
    alignColumns(editor, pos, 0, 1, 'center')
    expect(spotOf(editor.state)?.align).toBe('center')
    expect(expectStable(editor)).toMatch(/\| :-+: \| -+: \|/)
    alignColumns(editor, pos, 0, 2, 'left')
    expect(spotOf(editor.state)?.align).toBe(null)
    expect(expectStable(editor)).toMatch(/\| -+ \| -+ \|\n/)
  })

  it('tells where the cursor or the selected cells are', () => {
    const editor = open()
    const pos = cursorAt(editor, 2, 1)
    expect(spotOf(editor.state)).toEqual({ pos, rows: 3, columns: 2, top: 2, bottom: 3, left: 1, right: 2, header: true, align: 'right' })
    selectLine(editor, pos, { col: 0 })
    expect(spotOf(editor.state)).toMatchObject({ top: 0, bottom: 3, left: 0, right: 1, align: null })
    selectLine(editor, pos, { row: 1 })
    expect(spotOf(editor.state)).toMatchObject({ top: 1, bottom: 2, left: 0, right: 2 })
    cursorAt(editor, 0, 0)
    editor.commands.setTextSelection(1)
    expect(spotOf(open('Sin tabla').state)).toBe(null)
  })

  it('undoes quick changes one at a time, and apart from what was typed', () => {
    const editor = open(['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n'))
    const pos = cursorAt(editor, 1, 0)
    insertRow(editor, pos, 2, 0)
    insertRow(editor, pos, 3, 0)
    expect(cells(editor)).toHaveLength(4)
    editor.commands.undo()
    expect(cells(editor)).toHaveLength(3)
    cursorAt(editor, 1, 0)
    type(editor, 'x')
    deleteRows(editor, pos, 2, 3)
    editor.commands.undo()
    expect(cells(editor)).toEqual([['a', 'b'], ['x1', '2'], ['', '']])
  })

  it('moves rows and columns with the cursor elsewhere, as a handle does', () => {
    const editor = open(`Antes\n\n${TABLE}`)
    const pos = tablePos(editor)
    editor.commands.setTextSelection(1)
    expect(moveRow(editor, pos, 2, 1)).toBe(true)
    editor.commands.setTextSelection(1)
    expect(moveColumn(editor, pos, 1, 0)).toBe(true)
    expect(cells(editor)).toEqual([['Precio', 'Fruta'], ['3', 'Uva'], ['2', 'Pera']])
  })

  it('keeps one header row with a cell that spans two rows, pasted from a page', () => {
    const editor = new Editor({ extensions: documentExtensions(), content: '<table><tr><th rowspan="2">A</th><th>B</th></tr><tr><td>C</td></tr><tr><td>D</td><td>E</td></tr></table>' })
    editors.push(editor)
    const pos = tablePos(editor)
    const types = () => {
      const rows: string[][] = []
      editor.state.doc.nodeAt(pos)!.forEach((row) => {
        const names: string[] = []
        row.forEach((cell) => names.push(cell.type.name))
        rows.push(names)
      })
      return rows
    }
    cursorAt(editor, 2, 0)
    alignColumns(editor, pos, 0, 2, 'center')
    expect(types()[0]).toEqual(['tableHeader', 'tableHeader'])
    // Moving the last row up takes it above both rows the header cell spans: it becomes the header.
    moveRow(editor, pos, 2, 1)
    expect(types()).toEqual([['tableHeader', 'tableHeader'], ['tableCell', 'tableCell'], ['tableCell']])
  })

  it('undoes each change in one step', () => {
    const editor = open()
    const pos = cursorAt(editor, 1, 0)
    const before = editor.getMarkdown()
    insertColumn(editor, pos, 1, 1)
    editor.commands.undo()
    expect(editor.getMarkdown()).toBe(before)
  })
})
