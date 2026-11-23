import type { Editor } from '@tiptap/core'
import { type SelectionBookmark, TextSelection, type Transaction } from '@tiptap/pm/state'
import { TableMap } from '@tiptap/pm/tables'
import { useEditorState } from '@tiptap/react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Ellipsis,
  GripHorizontal,
  GripVertical,
  Plus,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Trash2,
} from 'lucide-react'
import { type ComponentProps, type KeyboardEvent, type ReactNode, useEffect, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from '../../../components/ui/Menu'
import { cn } from '../../../lib/cn'
import { isConverting } from '../../../lib/ime'
import {
  type Align,
  alignColumns,
  canInsertRow,
  canMoveColumn,
  canMoveRow,
  cellAt,
  deleteColumns,
  deleteRows,
  infoAt,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  selectLine,
  spotOf,
} from './table-commands'

/** The cell under the pointer: its table's position, row and column. */
type Hover = { pos: number; row: number; col: number }
type Open = 'bar' | 'row' | 'col' | null

const GAP = 8
const HANDLE = 20

/**
 * The controls of a table, as in Notion:
 * - a bar above the table with the cursor in it, also with the keyboard (Alt+F10) and on a phone;
 * - a handle on the row and the column under the pointer, with their menu;
 * - a «+» below and to the right, to add a row or a column at the end.
 */
export function TableControls({ editor }: { editor: Editor }) {
  const { t } = useTranslation('docs')
  const root = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLElement | null>(null)
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      spot: e.isEditable ? spotOf(e.state) : null,
      // Text selected in a cell has the format menu.
      selectingText: e.state.selection instanceof TextSelection && !e.state.selection.empty,
      focused: e.isFocused,
      editable: e.isEditable,
    }),
  })
  const [hover, setHover] = useState<Hover | null>(null)
  const hoverRef = useRef<Hover | null>(null)
  hoverRef.current = hover
  const [open, setOpen] = useState<Open>(null)
  const openRef = useRef<Open>(null)
  openRef.current = open
  /** The bar's menu is closing: the bar stays until the menu has put the focus back. */
  const [barClosing, setBarClosing] = useState(false)
  /** Whether the bar's menu was opened from the keyboard, so closing it goes back to its button. */
  const byKeyboard = useRef(false)
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const leaving = useRef<ReturnType<typeof setTimeout>>(undefined)
  /** Whether a menu item ran, so the menu leaves the focus in the editor; and the selection to bring back if none did. */
  const acted = useRef(false)
  const before = useRef<SelectionBookmark | null>(null)
  const [said, setSaid] = useState('')

  // Placed over the editor, the controls follow the table as it moves: typing, scrolling, resizing.
  useEffect(() => {
    let frame = 0
    const later = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(redraw)
    }
    const changed = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged) {
        // What a handle's menu acts on, and the selection it gives back, follow the change: an
        // agent or another tab can change the page while the menu is open.
        before.current = before.current?.map(transaction.mapping) ?? null
        const h = hoverRef.current
        if (openRef.current === 'row' || openRef.current === 'col') {
          const pos = h && transaction.mapping.map(h.pos)
          if (h && pos !== null && infoAt(transaction.doc, pos)) setHover({ ...h, pos })
          else {
            setOpen(null)
            setHover(null)
          }
        } else {
          // The handles were for a row that may have moved: they come back with the pointer.
          setHover(null)
        }
      }
      later()
    }
    editor.on('transaction', changed)
    window.addEventListener('scroll', later, true)
    window.addEventListener('resize', later)
    const observer = new ResizeObserver(later)
    observer.observe(editor.view.dom)
    let el = root.current?.parentElement ?? null
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement
    scroller.current = el
    later()
    return () => {
      cancelAnimationFrame(frame)
      editor.off('transaction', changed)
      window.removeEventListener('scroll', later, true)
      window.removeEventListener('resize', later)
      observer.disconnect()
    }
  }, [editor])

  // The handles appear on the cell under a mouse or a pen; a finger has the bar.
  useEffect(() => {
    const dom = editor.view.dom
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || !editor.isEditable) return
      const cell = (event.target as Element | null)?.closest?.('td, th')
      if (!cell || !dom.contains(cell)) return leave()
      stay()
      if (openRef.current) return
      const at = cellAt(editor.view, cell as HTMLElement)
      setHover((prev) => (at && prev && prev.pos === at.pos && prev.row === at.row && prev.col === at.col ? prev : at))
    }
    // Alt+F10 goes to the bar, as in other editors; Escape comes back. Selected text gives way to it.
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'F10' || !event.altKey || !spotOf(editor.state)) return
      event.preventDefault()
      const { selection } = editor.state
      if (selection instanceof TextSelection && !selection.empty) editor.commands.setTextSelection(selection.head)
      const first = () => bar.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
      if (bar.current) first()
      else requestAnimationFrame(() => requestAnimationFrame(first))
    }
    dom.addEventListener('pointermove', move)
    dom.addEventListener('pointerleave', leave)
    dom.addEventListener('keydown', key)
    return () => {
      dom.removeEventListener('pointermove', move)
      dom.removeEventListener('pointerleave', leave)
      dom.removeEventListener('keydown', key)
      clearTimeout(leaving.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  // A screen reader hears how to reach the bar once, on coming into a table: not on coming back from the bar.
  const inside = state.focused || open !== null || Boolean(root.current?.contains(document.activeElement))
  const inTable = inside && state.spot ? state.spot.pos : null
  useEffect(() => setSaid(inTable === null ? '' : t('editor.table.hint')), [inTable === null, t])

  function stay() {
    clearTimeout(leaving.current)
  }
  function leave() {
    clearTimeout(leaving.current)
    leaving.current = setTimeout(() => {
      if (!openRef.current) setHover(null)
    }, 250)
  }

  /** Where the table is on screen, as the controls are placed: the part of it in view when it scrolls sideways. */
  function measure(pos: number) {
    const base = root.current?.getBoundingClientRect()
    let wrapper: Node | null = null
    try {
      wrapper = editor.view.nodeDOM(pos)
    } catch {
      return null
    }
    const table = wrapper instanceof HTMLTableElement ? wrapper : wrapper instanceof HTMLElement ? wrapper.querySelector('table') : null
    if (!base || !(wrapper instanceof HTMLElement) || !table) return null
    const box = wrapper.getBoundingClientRect()
    const rect = table.getBoundingClientRect()
    return { base, table, top: rect.top, bottom: rect.bottom, left: Math.max(rect.left, box.left), right: Math.min(rect.right, box.right) }
  }

  function menuChange(o: boolean, which: Open) {
    setOpen((current) => (o ? which : current === which ? null : current))
    if (!o && which === 'bar') setBarClosing(true)
  }

  /** Where the focus goes as a menu closes: what was there stays until then, or it would have nowhere to go. */
  function closeFocus(event: Event, which: Open) {
    const ran = acted.current
    const bookmark = before.current
    const keyboard = byKeyboard.current
    acted.current = false
    before.current = null
    byKeyboard.current = false
    if (which === 'bar') {
      setBarClosing(false)
      // After an action, the editor, where it worked. Closed without one: the menu's button from the keyboard, the editor with a pointer.
      if (!ran && keyboard) return
      event.preventDefault()
      editor.view.focus()
      return
    }
    setHover(null)
    event.preventDefault()
    if (ran) return editor.view.focus()
    // A handle's menu closed without an action gives back the selection it took.
    editor
      .chain()
      .focus(undefined, { scrollIntoView: false })
      .command(({ tr }) => {
        try {
          if (bookmark) tr.setSelection(bookmark.resolve(tr.doc))
        } catch {
          // The page changed under the menu: the cursor stays where the change left it.
        }
        return true
      })
      .run()
  }

  /** A cell on screen by its row and column in the table, merged cells (pasted from a page) included. */
  function cellDom(pos: number, row: number, col: number) {
    const table = editor.state.doc.nodeAt(pos)
    if (table?.type.spec.tableRole !== 'table') return null
    const map = TableMap.get(table)
    const at = map.map[row * map.width + col]
    const dom = at === undefined ? null : editor.view.nodeDOM(pos + 1 + at)
    return dom instanceof HTMLElement ? dom : null
  }

  const act = (run: () => unknown) => () => {
    acted.current = true
    run()
  }

  const spot = state.spot
  const showBar = Boolean(spot && !state.selectingText && (state.focused || open === 'bar' || barClosing || root.current?.contains(document.activeElement)))
  const plusAt = hover?.pos ?? (showBar ? spot!.pos : null)
  // With a menu open, a click outside it only closes it, as anywhere else.
  const live = open === null ? 'pointer-events-auto' : ''

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 z-30 print:hidden">
      <div aria-live="polite" className="sr-only">
        {said}
      </div>
      {showBar && renderBar()}
      {state.editable && hover && renderHandles(hover)}
      {state.editable && plusAt !== null && renderPlus(plusAt)}
    </div>
  )

  // Render functions, not components: a component made in here would be a new one on every render,
  // and its open menu would close.
  function renderBar() {
    const s = spot!
    const g = measure(s.pos)
    if (!g) return null
    const height = bar.current?.offsetHeight ?? 36
    const viewTop = Math.max(0, scroller.current?.getBoundingClientRect().top ?? 0) + GAP
    const y = Math.min(Math.max(g.top - height - GAP, viewTop), g.bottom - height)
    const align = s.align ?? 'left'
    const rows = s.bottom - s.top
    const columns = s.right - s.left
    const aligns: Array<[Align, string, ReactNode]> = [
      ['left', t('editor.table.alignLeft'), <TextAlignStart key="l" />],
      ['center', t('editor.table.alignCenter'), <TextAlignCenter key="c" />],
      ['right', t('editor.table.alignRight'), <TextAlignEnd key="r" />],
    ]

    function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      // Keys in the open menu, which React passes up through it, are the menu's.
      if (!event.currentTarget.contains(event.target as Node)) return
      if (event.key === 'Escape' && !isConverting(event)) {
        event.preventDefault()
        editor.commands.focus()
        return
      }
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = ({ ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: buttons.length - 1 } as Record<string, number>)[event.key]
      if (next === undefined) return
      event.preventDefault()
      buttons[(next + buttons.length) % buttons.length]?.focus()
    }

    return (
      <div
        ref={bar}
        role="toolbar"
        aria-label={t('editor.table.toolbar')}
        // Its Escape goes back to the text, and doesn't close the card or dialog it is in.
        data-own-escape
        aria-keyshortcuts="Alt+F10"
        onKeyDown={onKeyDown}
        onFocus={redraw}
        onBlur={redraw}
        // A click keeps the cursor in the editor, on a phone the keyboard too. Not in the open menu.
        onMouseDown={(e) => e.currentTarget.contains(e.target as Node) && e.preventDefault()}
        className={cn('animate-pop absolute flex items-center gap-0.5 rounded-[12px] border border-line bg-surface p-1 shadow-lg', live)}
        style={{ top: y - g.base.top, left: g.left - g.base.left }}
      >
        <Tool label={t('editor.table.rowAbove')} disabled={!canInsertRow(s, s.top)} onClick={() => insertRow(editor, s.pos, s.top, s.left)}>
          <BetweenHorizontalStart />
        </Tool>
        <Tool label={t('editor.table.rowBelow')} onClick={() => insertRow(editor, s.pos, s.bottom, s.left)}>
          <BetweenHorizontalEnd />
        </Tool>
        <Tool label={t('editor.table.columnLeft')} onClick={() => insertColumn(editor, s.pos, s.left, s.top)}>
          <BetweenVerticalStart />
        </Tool>
        <Tool label={t('editor.table.columnRight')} onClick={() => insertColumn(editor, s.pos, s.right, s.top)}>
          <BetweenVerticalEnd />
        </Tool>
        <span className="mx-0.5 h-5 w-px bg-line" />
        {aligns.map(([value, label, icon]) => (
          <Tool key={value} label={label} active={align === value} onClick={() => alignColumns(editor, s.pos, s.left, s.right, value)}>
            {icon}
          </Tool>
        ))}
        <span className="mx-0.5 h-5 w-px bg-line" />
        <MenuRoot open={open === 'bar'} onOpenChange={(o) => menuChange(o, 'bar')}>
          <MenuTrigger asChild>
            <Tool
              label={t('editor.table.more')}
              onPointerDown={() => (byKeyboard.current = false)}
              onKeyDown={(e) => (byKeyboard.current = ['Enter', ' ', 'ArrowDown'].includes(e.key))}
            >
              <Ellipsis />
            </Tool>
          </MenuTrigger>
          <MenuContent align="start" onCloseAutoFocus={(e) => closeFocus(e, 'bar')}>
            <MenuItem icon={<ArrowUp />} disabled={rows !== 1 || !canMoveRow(s, s.top, s.top - 1)} onSelect={act(() => moveRow(editor, s.pos, s.top, s.top - 1))}>
              {t('editor.table.moveRowUp')}
            </MenuItem>
            <MenuItem icon={<ArrowDown />} disabled={rows !== 1 || !canMoveRow(s, s.top, s.top + 1)} onSelect={act(() => moveRow(editor, s.pos, s.top, s.top + 1))}>
              {t('editor.table.moveRowDown')}
            </MenuItem>
            <MenuItem icon={<ArrowLeft />} disabled={columns !== 1 || !canMoveColumn(s, s.left, s.left - 1)} onSelect={act(() => moveColumn(editor, s.pos, s.left, s.left - 1))}>
              {t('editor.table.moveColumnLeft')}
            </MenuItem>
            <MenuItem icon={<ArrowRight />} disabled={columns !== 1 || !canMoveColumn(s, s.left, s.left + 1)} onSelect={act(() => moveColumn(editor, s.pos, s.left, s.left + 1))}>
              {t('editor.table.moveColumnRight')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Trash2 />} danger disabled={rows >= s.rows} onSelect={act(() => deleteRows(editor, s.pos, s.top, s.bottom, s.left))}>
              {t('editor.table.deleteRows', { count: rows })}
            </MenuItem>
            <MenuItem icon={<Trash2 />} danger disabled={columns >= s.columns} onSelect={act(() => deleteColumns(editor, s.pos, s.left, s.right, s.top))}>
              {t('editor.table.deleteColumns', { count: columns })}
            </MenuItem>
            <MenuItem icon={<Trash2 />} danger onSelect={act(() => editor.chain().focus().deleteTable().run())}>
              {t('editor.table.deleteTable')}
            </MenuItem>
          </MenuContent>
        </MenuRoot>
      </div>
    )
  }

  function renderHandles(h: Hover) {
    const info = infoAt(editor.state.doc, h.pos)
    const g = measure(h.pos)
    const row = g?.table.rows[h.row]
    const cell = cellDom(h.pos, 0, h.col)
    if (!info || !g || !row || !cell) return null
    const r = row.getBoundingClientRect()
    const c = cell.getBoundingClientRect()
    const columnInView = c.right > g.left && c.left < g.right
    // A main click selects what the menu acts on; another button opens no menu.
    const take = (line: { row: number } | { col: number }) => (event: { button: number; ctrlKey: boolean }) => {
      if (event.button !== 0 || event.ctrlKey) return
      before.current = editor.state.selection.getBookmark()
      selectLine(editor, h.pos, line)
    }
    const handle = 'absolute grid place-items-center rounded-[6px] border border-line bg-surface text-ink-3 shadow-sm hover:bg-hover hover:text-ink data-[state=open]:bg-accent-soft data-[state=open]:text-accent [&_svg]:size-[13px]'
    const hold = { onPointerEnter: stay, onPointerLeave: leave }

    return (
      <>
        <MenuRoot open={open === 'row'} onOpenChange={(o) => menuChange(o, 'row')}>
          <MenuTrigger asChild>
            <button
              type="button"
              tabIndex={-1}
              aria-label={t('editor.table.rowMenu')}
              title={t('editor.table.rowMenu')}
              className={cn(handle, live)}
              style={{ width: HANDLE - 6, height: HANDLE, left: g.left - g.base.left - (HANDLE - 6) / 2, top: r.top - g.base.top + r.height / 2 - HANDLE / 2 }}
              onPointerDown={take({ row: h.row })}
              {...hold}
            >
              <GripVertical />
            </button>
          </MenuTrigger>
          <MenuContent align="start" side="right" onCloseAutoFocus={(e) => closeFocus(e, 'row')}>
            <MenuItem icon={<BetweenHorizontalStart />} disabled={!canInsertRow(info, h.row)} onSelect={act(() => insertRow(editor, h.pos, h.row, 0))}>
              {t('editor.table.rowAbove')}
            </MenuItem>
            <MenuItem icon={<BetweenHorizontalEnd />} onSelect={act(() => insertRow(editor, h.pos, h.row + 1, 0))}>
              {t('editor.table.rowBelow')}
            </MenuItem>
            <MenuItem icon={<ArrowUp />} disabled={!canMoveRow(info, h.row, h.row - 1)} onSelect={act(() => moveRow(editor, h.pos, h.row, h.row - 1))}>
              {t('editor.table.moveRowUp')}
            </MenuItem>
            <MenuItem icon={<ArrowDown />} disabled={!canMoveRow(info, h.row, h.row + 1)} onSelect={act(() => moveRow(editor, h.pos, h.row, h.row + 1))}>
              {t('editor.table.moveRowDown')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Trash2 />} danger disabled={info.rows === 1} onSelect={act(() => deleteRows(editor, h.pos, h.row, h.row + 1, h.col))}>
              {t('editor.table.deleteRows', { count: 1 })}
            </MenuItem>
          </MenuContent>
        </MenuRoot>
        {columnInView && (
          <MenuRoot open={open === 'col'} onOpenChange={(o) => menuChange(o, 'col')}>
            <MenuTrigger asChild>
              <button
                type="button"
                tabIndex={-1}
                aria-label={t('editor.table.columnMenu')}
                title={t('editor.table.columnMenu')}
                className={cn(handle, live)}
                style={{
                  width: HANDLE,
                  height: HANDLE - 6,
                  left: Math.min(Math.max(c.left + c.width / 2, g.left + HANDLE / 2), g.right - HANDLE / 2) - g.base.left - HANDLE / 2,
                  top: g.top - g.base.top - (HANDLE - 6) / 2,
                }}
                onPointerDown={take({ col: h.col })}
                {...hold}
              >
                <GripHorizontal />
              </button>
            </MenuTrigger>
            <MenuContent align="start" onCloseAutoFocus={(e) => closeFocus(e, 'col')}>
              <MenuItem icon={<BetweenVerticalStart />} onSelect={act(() => insertColumn(editor, h.pos, h.col, 0))}>
                {t('editor.table.columnLeft')}
              </MenuItem>
              <MenuItem icon={<BetweenVerticalEnd />} onSelect={act(() => insertColumn(editor, h.pos, h.col + 1, 0))}>
                {t('editor.table.columnRight')}
              </MenuItem>
              <MenuItem icon={<ArrowLeft />} disabled={!canMoveColumn(info, h.col, h.col - 1)} onSelect={act(() => moveColumn(editor, h.pos, h.col, h.col - 1))}>
                {t('editor.table.moveColumnLeft')}
              </MenuItem>
              <MenuItem icon={<ArrowRight />} disabled={!canMoveColumn(info, h.col, h.col + 1)} onSelect={act(() => moveColumn(editor, h.pos, h.col, h.col + 1))}>
                {t('editor.table.moveColumnRight')}
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<TextAlignStart />} onSelect={act(() => alignColumns(editor, h.pos, h.col, h.col + 1, 'left'))}>
                {t('editor.table.alignLeft')}
              </MenuItem>
              <MenuItem icon={<TextAlignCenter />} onSelect={act(() => alignColumns(editor, h.pos, h.col, h.col + 1, 'center'))}>
                {t('editor.table.alignCenter')}
              </MenuItem>
              <MenuItem icon={<TextAlignEnd />} onSelect={act(() => alignColumns(editor, h.pos, h.col, h.col + 1, 'right'))}>
                {t('editor.table.alignRight')}
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Trash2 />} danger disabled={info.columns === 1} onSelect={act(() => deleteColumns(editor, h.pos, h.col, h.col + 1, h.row))}>
                {t('editor.table.deleteColumns', { count: 1 })}
              </MenuItem>
            </MenuContent>
          </MenuRoot>
        )}
      </>
    )
  }

  function renderPlus(pos: number) {
    const info = infoAt(editor.state.doc, pos)
    const g = measure(pos)
    if (!info || !g) return null
    const button =
      'absolute grid place-items-center rounded-[6px] text-ink-4 transition-colors hover:bg-hover hover:text-ink-2 [&_svg]:size-[13px]'
    const hold = { onPointerEnter: stay, onPointerLeave: leave, onMouseDown: (e: { preventDefault(): void }) => e.preventDefault() }
    return (
      <>
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('editor.table.addRow')}
          title={t('editor.table.addRow')}
          className={cn(button, live)}
          style={{ left: g.left - g.base.left, top: g.bottom - g.base.top + 2, width: g.right - g.left, height: 16 }}
          onClick={() => insertRow(editor, pos, info.rows, 0)}
          {...hold}
        >
          <Plus />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('editor.table.addColumn')}
          title={t('editor.table.addColumn')}
          className={cn(button, live)}
          style={{ left: g.right - g.base.left + 2, top: g.top - g.base.top, width: 16, height: g.bottom - g.top }}
          onClick={() => insertColumn(editor, pos, info.columns, 0)}
          {...hold}
        >
          <Plus />
        </button>
      </>
    )
  }
}

/** A button of the bar; also the trigger of its menu, which passes it its props. Arrows move between them. */
function Tool({ label, active, children, ...rest }: ComponentProps<'button'> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      tabIndex={-1}
      {...rest}
      className="grid h-7 min-w-7 place-items-center rounded-[7px] px-1 text-ink-2 transition-colors hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-35 aria-pressed:bg-accent-soft aria-pressed:text-accent [&_svg]:size-[15px]"
    >
      {children}
    </button>
  )
}
