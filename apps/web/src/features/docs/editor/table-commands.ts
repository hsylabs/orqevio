import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { type EditorState, Selection, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import {
  CellSelection,
  TableMap,
  type TableRect,
  addColumn,
  addRow,
  cellAround,
  deleteTable as deleteTableCommand,
  isInTable,
  moveTableColumn,
  moveTableRow,
  removeColumn,
  removeRow,
  selectedRect,
} from '@tiptap/pm/tables'
import { type StepProps, ownStep } from './own-step'

/**
 * What the table controls do, on the table at a position and by row and column, so a handle can act
 * on its own row without moving the cursor first. Documents are Markdown, where a table always has
 * one header row, first, and no merged cells: the header row stays first and stays the only one.
 */

export type Align = 'left' | 'center' | 'right'

/** The table at `pos` and the rows and columns the cursor or the selected cells take, end excluded. */
export interface TableSpot {
  pos: number
  rows: number
  columns: number
  top: number
  bottom: number
  left: number
  right: number
  /** Whether the first row is a header, as every table read from Markdown has. */
  header: boolean
  /** The alignment of the first of those columns; none is to the left. */
  align: Align | null
}

function rectAt(doc: PMNode, pos: number): TableRect | null {
  const table = doc.nodeAt(pos)
  if (table?.type.spec.tableRole !== 'table') return null
  const map = TableMap.get(table)
  return { map, table, tableStart: pos + 1, left: 0, top: 0, right: map.width, bottom: map.height }
}

/** The cells of a row or a column, each once, as positions inside the table. */
function cellsOf(rect: TableRect, { row, col }: { row?: number; col?: number }) {
  const { map } = rect
  const indexes = row !== undefined ? Array.from({ length: map.width }, (_, c) => row * map.width + c) : Array.from({ length: map.height }, (_, r) => r * map.width + (col ?? 0))
  return [...new Set(indexes.map((i) => map.map[i]!))]
}

/** Whether the first row is a header: as its Markdown writes it, when any of its cells is one. */
function headerRow(rect: TableRect) {
  return cellsOf(rect, { row: 0 }).some((cell) => rect.table.nodeAt(cell)?.type.spec.tableRole === 'header_cell')
}

/** How the column is aligned: the first of its cells that says it, as its Markdown says it for all of them. */
function columnAlign(rect: TableRect, col: number): Align | null {
  for (const cell of cellsOf(rect, { col })) {
    const align = rect.table.nodeAt(cell)?.attrs.align as Align | null | undefined
    if (align) return align
  }
  return null
}

/** The size of the table at `pos`, and whether its first row is a header; none if there is no table there. */
export function infoAt(doc: PMNode, pos: number): Pick<TableSpot, 'rows' | 'columns' | 'header'> | null {
  const rect = rectAt(doc, pos)
  return rect ? { rows: rect.map.height, columns: rect.map.width, header: headerRow(rect) } : null
}

export function spotOf(state: EditorState): TableSpot | null {
  if (!isInTable(state)) return null
  const rect = selectedRect(state)
  return {
    pos: rect.tableStart - 1,
    rows: rect.map.height,
    columns: rect.map.width,
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
    header: headerRow(rect),
    align: columnAlign(rect, rect.left),
  }
}

/** The table, row and column of a cell shown in the editor. */
export function cellAt(view: EditorView, cell: HTMLElement): { pos: number; row: number; col: number } | null {
  let inside: number
  try {
    inside = view.posAtDOM(cell, 0)
  } catch {
    return null
  }
  const $cell = cellAround(view.state.doc.resolve(inside))
  if (!$cell) return null
  const tableStart = $cell.start(-1)
  const found = TableMap.get($cell.node(-1)).findCell($cell.pos - tableStart)
  return { pos: tableStart - 1, row: found.top, col: found.left }
}

/**
 * After a change, the first row is the header again if it was one, and the only one: what was inserted
 * above it or moved there takes its place, as the Markdown will read. A cell takes its column's alignment.
 */
function tidy(tr: Transaction, pos: number, header: boolean, aligns?: Array<Align | null>) {
  const rect = rectAt(tr.doc, pos)
  if (!rect) return
  const { tableHeader, tableCell } = rect.table.type.schema.nodes
  for (let row = 0; row < rect.map.height; row++) {
    for (const at of cellsOf(rect, { row })) {
      // A cell that spans rows (pasted from a page) belongs to the row it starts in.
      if (rect.map.findCell(at).top !== row) continue
      const node = rect.table.nodeAt(at)!
      const type = !header ? node.type : row === 0 ? tableHeader! : tableCell!
      const col = rect.map.findCell(at).left
      const align = aligns ? (aligns[col] ?? null) : node.attrs.align
      if (node.type !== type || node.attrs.align !== align) tr.setNodeMarkup(rect.tableStart + at, type, { ...node.attrs, align })
    }
  }
}

/** Puts the cursor at the start of a cell. */
function cursorIn(tr: Transaction, pos: number, row: number, col: number) {
  const rect = rectAt(tr.doc, pos)
  if (!rect) return
  const r = Math.max(0, Math.min(row, rect.map.height - 1))
  const c = Math.max(0, Math.min(col, rect.map.width - 1))
  const cell = rect.tableStart + rect.map.map[r * rect.map.width + c]!
  tr.setSelection(Selection.near(tr.doc.resolve(cell + 1)))
}

/** A change to the table at `pos`, undone on its own (see ownStep). */
function change(editor: Editor, pos: number, build: (tr: Transaction, rect: TableRect, props: StepProps) => boolean) {
  return ownStep(editor, (props) => {
    const rect = rectAt(props.tr.doc, pos)
    return rect ? build(props.tr, rect, props) : false
  })
}

const aligns = (rect: TableRect) => Array.from({ length: rect.map.width }, (_, col) => columnAlign(rect, col))

/** Whether a row can go in at `index`: never above the header row. */
export const canInsertRow = (spot: Pick<TableSpot, 'header'>, index: number) => !spot.header || index > 0

/** A new, empty row at `index`, with the cursor in it, in column `col`. */
export function insertRow(editor: Editor, pos: number, index: number, col = 0) {
  return change(editor, pos, (tr, rect) => {
    const header = headerRow(rect)
    if (!canInsertRow({ header }, index) || index < 0 || index > rect.map.height) return false
    const columns = aligns(rect)
    addRow(tr, rect, index)
    tidy(tr, pos, header, columns)
    cursorIn(tr, pos, index, col)
    return true
  })
}

/** A new, empty column at `index`, with the cursor in it, in row `row`. */
export function insertColumn(editor: Editor, pos: number, index: number, row = 0) {
  return change(editor, pos, (tr, rect) => {
    if (index < 0 || index > rect.map.width) return false
    const header = headerRow(rect)
    const columns = aligns(rect)
    columns.splice(index, 0, null)
    addColumn(tr, rect, index)
    tidy(tr, pos, header, columns)
    cursorIn(tr, pos, row, index)
    return true
  })
}

/** Whether row `from` can move to `to`: the header row stays first. */
export function canMoveRow(spot: Pick<TableSpot, 'header' | 'rows'>, from: number, to: number) {
  return to >= 0 && to < spot.rows && from !== to && (!spot.header || (from > 0 && to > 0))
}

/** Moves a row, and selects it where it went. */
export function moveRow(editor: Editor, pos: number, from: number, to: number) {
  return change(editor, pos, (tr, rect, { state, dispatch }) => {
    const header = headerRow(rect)
    if (!canMoveRow({ header, rows: rect.map.height }, from, to)) return false
    // The move finds its rows from the selection: it has to be in this table.
    cursorIn(tr, pos, from, 0)
    if (!moveTableRow({ from, to, pos: pos + 1, select: true })(state, dispatch)) return false
    // Rows spanned by a pasted cell move together, and could take the header's place.
    tidy(tr, pos, header)
    return true
  })
}

export const canMoveColumn = (spot: Pick<TableSpot, 'columns'>, from: number, to: number) => to >= 0 && to < spot.columns && from !== to

/** Moves a column, and selects it where it went. */
export function moveColumn(editor: Editor, pos: number, from: number, to: number) {
  return change(editor, pos, (tr, rect, { state, dispatch }) => {
    if (!canMoveColumn({ columns: rect.map.width }, from, to)) return false
    cursorIn(tr, pos, 0, from)
    return moveTableColumn({ from, to, pos: pos + 1, select: true })(state, dispatch)
  })
}

/** Rows `top` to `bottom` (excluded) go, as long as one is left. With the header row gone, the next one is the header. */
export function deleteRows(editor: Editor, pos: number, top: number, bottom: number, col = 0) {
  return change(editor, pos, (tr, rect) => {
    if (top < 0 || bottom > rect.map.height || bottom <= top || bottom - top >= rect.map.height) return false
    const header = headerRow(rect)
    for (let row = bottom - 1; row >= top; row--) removeRow(tr, rectAt(tr.doc, pos)!, row)
    tidy(tr, pos, header)
    cursorIn(tr, pos, top, col)
    return true
  })
}

/** Columns `left` to `right` (excluded) go, as long as one is left. */
export function deleteColumns(editor: Editor, pos: number, left: number, right: number, row = 0) {
  return change(editor, pos, (tr, rect) => {
    if (left < 0 || right > rect.map.width || right <= left || right - left >= rect.map.width) return false
    for (let col = right - 1; col >= left; col--) removeColumn(tr, rectAt(tr.doc, pos)!, col)
    cursorIn(tr, pos, row, left)
    return true
  })
}

/** The whole table goes, the cursor where it was. */
export function deleteTable(editor: Editor, pos: number) {
  return change(editor, pos, (tr, _rect, { state, dispatch }) => {
    cursorIn(tr, pos, 0, 0)
    return deleteTableCommand(state, dispatch)
  })
}

/** Aligns columns `left` to `right` (excluded). To the left is how a column is unless it says otherwise. */
export function alignColumns(editor: Editor, pos: number, left: number, right: number, align: Align) {
  return change(editor, pos, (tr, rect) => {
    const columns = aligns(rect)
    for (let col = left; col < right; col++) columns[col] = align === 'left' ? null : align
    tidy(tr, pos, headerRow(rect), columns)
    return true
  })
}

/** Selects a whole row or column, to show what its handle acts on. */
export function selectLine(editor: Editor, pos: number, line: { row: number } | { col: number }) {
  const rect = rectAt(editor.state.doc, pos)
  if (!rect) return false
  const { map, tableStart } = rect
  const [first, last] =
    'row' in line ? [line.row * map.width, line.row * map.width + map.width - 1] : [line.col, (map.height - 1) * map.width + line.col]
  const $anchor = editor.state.doc.resolve(tableStart + map.map[first]!)
  const $head = editor.state.doc.resolve(tableStart + map.map[last]!)
  const selection = 'row' in line ? CellSelection.rowSelection($anchor, $head) : CellSelection.colSelection($anchor, $head)
  editor.view.dispatch(editor.state.tr.setSelection(selection))
  return true
}
