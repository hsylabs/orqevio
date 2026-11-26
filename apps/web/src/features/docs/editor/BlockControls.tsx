import type { Editor } from '@tiptap/core'
import { NodeSelection, Selection, type SelectionBookmark, type Transaction } from '@tiptap/pm/state'
import { useEditorState } from '@tiptap/react'
import { ArrowDown, ArrowUp, ClipboardCopy, Code, Copy, GripVertical, Info, Plus, Repeat, Trash2 } from 'lucide-react'
import { type DragEvent, useEffect, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isMac } from '../../../components/ui/Kbd'
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from '../../../components/ui/Menu'
import { cn } from '../../../lib/cn'
import { CalloutTypeItems } from './CalloutControls'
import { codeStorage, copyCode } from './code-block'
import { changeOf, followBlock } from './own-step'
import { TOGGLE_VIEW } from './toggle'
import { MARKDOWN_SHORTCUTS, TURN_ICONS, blockAt, canMove, deleteBlock, duplicateBlock, moveBlock, turnBlock, turns } from './block-commands'
import { closeOpenedFor, openBelow } from './insert-below'
import { ROW_HANDLE_REACH } from './TableControls'

/** The handle and the «+», each: 24 px, the least WCAG asks of a target (2.5.8); 32 px for a finger. */
const SIZE = 24
const TOUCH_SIZE = 32
/** Between the handle and its block's text. The page leaves room for both (DocPage, CardSheet). */
const GAP = 4
/** Between the «+» and the handle, left of it. */
const PLUS_GAP = 2
/** Between a table's handle and its rows' handles, which reach out of its left edge (TableControls), or its top-left corner. */
const TABLE_GAP = 4
/** How much wider than a table's handle and «+» above its corner the way to them is taken to be. */
const TOWARD = 4
/** Room for a list item's bullet or number, left of its text. */
const MARKER = 20

const MOD = isMac ? '⌘' : 'Ctrl+'
const SHIFT = isMac ? '⇧' : 'Shift+'

/**
 * The handle of a block, as in Notion: ⋮⋮ left of the block under the pointer, or of the block with
 * the cursor on a phone. Dragged, it moves the block; clicked (or Ctrl+/), it opens the block's menu.
 * The «+» left of it opens the «/» menu on a line below the block (insert-below.ts); from the
 * keyboard, so does «Insert below» in the block's menu.
 */
export function BlockControls({ editor }: { editor: Editor }) {
  const { t } = useTranslation('docs')
  const root = useRef<HTMLDivElement>(null)
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      editable: e.isEditable,
      focused: e.isFocused,
      cursor: e.isEditable ? (blockAt(e.state.doc, e.state.selection.from)?.pos ?? null) : null,
    }),
  })
  // Without a pointer that hovers (a phone), the handle is the one of the block with the cursor.
  const touch = useRef(typeof matchMedia === 'function' && matchMedia('(hover: none)').matches).current
  const size = touch ? TOUCH_SIZE : SIZE
  const [hover, setHover] = useState<number | null>(null)
  const hoverRef = useRef<number | null>(null)
  hoverRef.current = hover
  /** Where the pointer last was over a table, maybe on its way to the table's handle above its corner. */
  const lastOnTable = useRef<{ x: number; y: number } | null>(null)
  const [menu, setMenu] = useState<number | null>(null)
  /** The block whose menu is closing: its handle stays until the menu has put the focus back. */
  const [closing, setClosing] = useState<number | null>(null)
  const menuRef = useRef<number | null>(null)
  menuRef.current = menu
  const closingRef = useRef<number | null>(null)
  closingRef.current = closing
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const leaving = useRef<ReturnType<typeof setTimeout>>(undefined)
  /** Whether a handle is pressed or dragged: it stays where it is, whatever the pointer goes over. */
  const held = useRef(false)
  /** Whether the handle was pressed by a finger, which opens the menu as it lifts, not with a click. */
  const finger = useRef(false)
  /** Whether a menu item ran, and the selection to bring back if none did. */
  const acted = useRef(false)
  const before = useRef<SelectionBookmark | null>(null)
  /** The code block whose list of languages opens once the menu has closed and given the focus back. */
  const languages = useRef<number | null>(null)
  /** A callout inside the block with the cursor (in a list item, in a quote): its types are in the block's menu too. */
  const [inner, setInner] = useState<number | null>(null)
  /** What would cut the «+» off on its left: the box the editor scrolls in, such as a card's panel. */
  const clip = useRef<Element | null>(null)
  useEffect(() => {
    let el = root.current?.parentElement ?? null
    while (el && getComputedStyle(el).overflowX === 'visible') el = el.parentElement
    clip.current = el
  }, [])

  // The handle follows its block as the page changes, scrolls or resizes.
  useEffect(() => {
    let frame = 0
    const later = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(redraw)
    }
    const changed = (event: { transaction: Transaction; appendedTransactions?: Transaction[] }) => {
      const change = changeOf(event)
      if (change.docChanged) {
        // An agent or another tab can change the page while the menu is open: it follows its block.
        before.current = before.current?.map(change.mapping) ?? null
        // The same for a menu that is closing, so its handle doesn't show on another block meanwhile.
        const follow = (pos: number | null) => (pos === null ? null : followBlock(change, pos))
        if (menuRef.current !== null) setMenu(follow(menuRef.current))
        if (closingRef.current !== null) setClosing(follow(closingRef.current))
        setInner((pos) => follow(pos))
        // Showing or hiding a toggle moves what is under it, not the block the pointer is on.
        if (![event.transaction, ...(event.appendedTransactions ?? [])].every((tr) => !tr.docChanged || tr.getMeta(TOGGLE_VIEW))) setHover(null)
      }
      later()
    }
    editor.on('transaction', changed)
    window.addEventListener('scroll', later, true)
    window.addEventListener('resize', later)
    const observer = new ResizeObserver(later)
    observer.observe(editor.view.dom)
    return () => {
      cancelAnimationFrame(frame)
      editor.off('transaction', changed)
      window.removeEventListener('scroll', later, true)
      window.removeEventListener('resize', later)
      observer.disconnect()
    }
  }, [editor])

  useEffect(() => {
    const dom = editor.view.dom
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || !editor.isEditable || held.current) return
      // On the way up to a table's handle above its corner, over the line above the table.
      if (towardCorner(event)) return stay()
      const block = itemAt(event) ?? blockAtHeight(event)
      lastOnTable.current = block && editor.state.doc.nodeAt(block.pos)?.type.name === 'table' ? { x: event.clientX, y: event.clientY } : null
      if (!block) return leave()
      stay()
      if (menuRef.current === null) setHover(block.pos)
    }
    // Over a list, the item at the pointer's height: also over its bullet or checkbox, in the
    // margin of a list inside it, or between two items.
    const itemAt = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const li = target?.closest('li') ?? null
      const list = target?.closest('ul, ol') ?? null
      // The list inside an item (in a to-do, it is deeper, after its checkbox) level with the pointer.
      const inner = (item: Element) =>
        [...item.querySelectorAll('ul, ol')].find((nested) => {
          if (nested.parentElement?.closest('li') !== item) return false
          const box = nested.getBoundingClientRect()
          return event.clientY >= box.top && event.clientY <= box.bottom
        })
      // In a list's margin: its item nearest the pointer's height, and down into the list inside
      // that item while the pointer is level with it.
      const pick = (from: Element): Element | null => {
        let best: Element | null = null
        let distance = Infinity
        for (const child of from.children) {
          if (child.tagName !== 'LI') continue
          const box = child.getBoundingClientRect()
          const away = event.clientY < box.top ? box.top - event.clientY : Math.max(0, event.clientY - box.bottom)
          if (away < distance) [best, distance] = [child, away]
        }
        const nested = best && inner(best)
        return nested ? (pick(nested) ?? best) : best
      }
      let item: Element | null = li
      if (list && (!li || li.contains(list))) item = pick(list)
      else if (li) {
        // Over an item's own box, beside or below its checkbox: the item inside it at that height.
        const nested = inner(li)
        if (nested) item = pick(nested) ?? li
      }
      if (!item || !dom.contains(item)) return null
      try {
        return blockAt(editor.state.doc, editor.view.posAtDOM(item, 0))
      } catch {
        return null
      }
    }
    // Elsewhere, the block at the pointer's height, also from the margin left of the text.
    const blockAtHeight = (event: PointerEvent) => {
      const box = dom.getBoundingClientRect()
      const at = editor.view.posAtCoords({ left: Math.min(Math.max(event.clientX, box.left + 1), box.right - 1), top: event.clientY })
      return at && blockAt(editor.state.doc, at.inside >= 0 ? at.inside : at.pos)
    }
    const release = () => (held.current = false)
    dom.addEventListener('pointermove', move)
    dom.addEventListener('pointerleave', leave)
    window.addEventListener('pointerup', release)
    // Ctrl+/ (⌘/), a key of the editor (BlockKeys), opens the menu of the block with the cursor.
    const storage = (editor.storage as unknown as { blockKeys?: { openMenu: ((pos: number) => void) | null } }).blockKeys
    if (storage) storage.openMenu = (pos) => openMenuRef.current(pos)
    return () => {
      window.removeEventListener('pointerup', release)
      dom.removeEventListener('pointermove', move)
      dom.removeEventListener('pointerleave', leave)
      if (storage) storage.openMenu = null
      clearTimeout(leaving.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  function stay() {
    clearTimeout(leaving.current)
  }
  function leave() {
    clearTimeout(leaving.current)
    // With the pointer on the handle or the «+», they stay, however long it rests there. Asked when
    // the time is up: React tells of the pointer coming onto them before the editor tells of it
    // leaving the text, which starts the timer again.
    leaving.current = setTimeout(() => !held.current && !root.current?.querySelector(':hover') && setHover(null), 250)
  }

  /**
   * Whether a table's handle goes above its top-left corner: under a mouse, its rows have handles of
   * their own on its left edge (TableControls), which it keeps clear of, further left where there is
   * room for that (not in a narrow window).
   */
  function atCorner(box: DOMRect) {
    const clipLeft = Math.max(0, clip.current?.getBoundingClientRect().left ?? 0)
    return !touch && box.left - size - GAP - (ROW_HANDLE_REACH + TABLE_GAP - GAP) < clipLeft
  }

  /**
   * Whether the pointer, off the table it was on, is on its way to the table's handle above its
   * corner, or the «+» above that: within the triangle from where it left the table to them, as a
   * menu keeps its submenu. Still the table's then, though it goes over the line above the table;
   * straight up onto that line, the line's own.
   */
  function towardCorner(event: PointerEvent) {
    const at = hoverRef.current
    const from = lastOnTable.current
    if (at === null || !from || editor.state.doc.nodeAt(at)?.type.name !== 'table') return false
    let dom: Node | null = null
    try {
      dom = editor.view.nodeDOM(at)
    } catch {
      return false
    }
    if (!(dom instanceof HTMLElement)) return false
    const box = dom.getBoundingClientRect()
    const { clientX: x, clientY: y } = event
    if (y >= box.top || !atCorner(box)) return false
    // The handle and the «+» above it, a little wider.
    const left = box.left - size - GAP - TOWARD
    const right = box.left - GAP + TOWARD
    const top = box.top - TABLE_GAP - 2 * size - PLUS_GAP - TOWARD
    const bottom = box.top - TABLE_GAP + TOWARD
    if (x >= left && x <= right && y >= top && y <= bottom) return true
    // Which side of the line from a to b the pointer is on.
    const side = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.sign((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x))
    const corners = [from, { x: right, y: top }, { x: left, y: bottom }]
    const sides = corners.map((a, i) => side(a, corners[(i + 1) % 3]!))
    return sides.every((s) => s >= 0) || sides.every((s) => s <= 0)
  }

  const openMenuRef = useRef(openMenu)
  openMenuRef.current = openMenu

  /** The menu acts on its block, selected while it is open to show which one. */
  function openMenu(at: number) {
    // A line a «+» opened goes first, and the block is where that leaves it; not on the line itself.
    const pos = closeOpenedFor(editor, at)
    // The open line's own handle: back to the line and its «/» menu.
    if (pos === null) return editor.view.focus()
    if (!editor.state.doc.nodeAt(pos)) return
    before.current = editor.state.selection.getBookmark()
    setInner(calloutWithin(pos))
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)))
    setMenu(pos)
  }

  /** The callout nearest the cursor, if it is inside the block at `pos` and not the block itself. */
  function calloutWithin(pos: number) {
    const { $from } = editor.state.selection
    const block = editor.state.doc.nodeAt(pos)
    if (!block) return null
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).type.name !== 'callout') continue
      const at = $from.before(depth)
      return at > pos && at < pos + block.nodeSize ? at : null
    }
    return null
  }

  function closeMenu(open: boolean) {
    if (open || menu === null) return
    setClosing(menu)
    setMenu(null)
  }

  /** As the menu closes: the cursor where the action left it, or back where it was before the menu. */
  function closeFocus(event: Event) {
    event.preventDefault()
    const ran = acted.current
    const bookmark = before.current
    const language = languages.current
    acted.current = false
    before.current = null
    languages.current = null
    setClosing(null)
    setHover(null)
    if (ran) return editor.view.focus()
    if (language !== null) {
      // «Language…»: the cursor goes back where it was, and the list takes the focus (it gives it
      // back as it closes). Focused now, the editor would take it from the list a moment later.
      try {
        if (bookmark) editor.view.dispatch(editor.state.tr.setSelection(bookmark.resolve(editor.state.doc)))
      } catch {
        // The page changed under the menu: the cursor stays where the change left it.
      }
      codeStorage(editor)?.openLanguages?.(language)
      return
    }
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

  const act = (run: () => unknown) => () => {
    acted.current = true
    run()
  }

  /** Dragged, the block moves where it is dropped, as ProseMirror moves what is dragged within the editor. */
  function drag(event: DragEvent, pos: number) {
    const { view } = editor
    if (!editor.isEditable || !editor.state.doc.nodeAt(pos)) return event.preventDefault()
    const selection = NodeSelection.create(view.state.doc, pos)
    view.dispatch(view.state.tr.setSelection(selection))
    const slice = selection.content()
    const { dom, text } = view.serializeForClipboard(slice)
    event.dataTransfer.clearData()
    event.dataTransfer.setData('text/html', dom.innerHTML)
    event.dataTransfer.setData('text/plain', text)
    event.dataTransfer.effectAllowed = 'copyMove'
    const block = view.nodeDOM(pos)
    if (block instanceof HTMLElement) event.dataTransfer.setDragImage(block, 0, 0)
    // Dropped, ProseMirror deletes the selection, the block, as the page may have changed since.
    view.dragging = { slice, move: true }
  }

  const inside = state.focused || Boolean(root.current?.contains(document.activeElement))
  const shown = menu ?? closing ?? hover ?? (touch && inside ? state.cursor : null)
  // With the menu open, a click outside it only closes it.
  const live = menu === null && closing === null ? 'pointer-events-auto' : ''

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 z-30 print:hidden">
      {state.editable && shown !== null && renderHandle(shown)}
    </div>
  )

  // A render function, not a component: a component made in here would be a new one on every
  // render, and its open menu would close.
  function renderHandle(pos: number) {
    const node = editor.state.doc.nodeAt(pos)
    let dom: Node | null = null
    try {
      dom = editor.view.nodeDOM(pos)
    } catch {
      return null
    }
    if (!node || !(dom instanceof HTMLElement) || !root.current) return null
    const base = root.current.getBoundingClientRect()
    const box = dom.getBoundingClientRect()
    // Level with the block's first line of text, or its top for a table, a rule or HTML.
    let line = { top: box.top, bottom: box.top + Math.min(box.height, 28) }
    if (!node.isAtom && node.type.name !== 'table') {
      const first = Selection.findFrom(editor.state.doc.resolve(pos + 1), 1, true)
      if (first && first.from < pos + node.nodeSize) {
        try {
          const at = editor.view.coordsAtPos(first.from)
          line = { top: at.top, bottom: at.top + Math.min(at.bottom - at.top, 28) }
        } catch {
          // Not drawn yet: the block's top will do.
        }
      }
    }
    const clipLeft = Math.max(0, clip.current?.getBoundingClientRect().left ?? 0)
    // A bullet or a number sits left of its item's box; a task's checkbox is inside it.
    let left = box.left - (node.type.name === 'listItem' ? MARKER : 0) - size - GAP - base.left
    let top = (line.top + line.bottom) / 2 - size / 2 - base.top
    // A table's keeps clear of its rows' handles: further left, or above its top-left corner.
    const corner = node.type.name === 'table' && atCorner(box)
    if (corner) top = box.top - TABLE_GAP - size - base.top
    else if (node.type.name === 'table' && !touch) left -= ROW_HANDLE_REACH + TABLE_GAP - GAP
    const { current, options } = turns(editor.state.doc, pos)
    const label = t('editor.block.handle')
    const side = base.left + left - size - PLUS_GAP >= clipLeft
    const callout = node.type.name === 'callout' ? pos : menu === pos && inner !== null && editor.state.doc.nodeAt(inner)?.type.name === 'callout' ? inner : null

    return (
      <div className={cn('absolute', live)} style={{ top, left, width: size, height: size }} onPointerEnter={stay} onPointerLeave={leave}>
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('editor.block.insertBelow')}
          title={t('editor.block.insertHint')}
          className="absolute grid place-items-center rounded-[6px] text-ink-4 transition-colors hover:bg-hover hover:text-ink-2 [&_svg]:size-4"
          // Left of the handle, or where there is no room on its left (a card, a phone, a narrow
          // window) under it; above it at a table's corner, as the table is under it.
          style={side ? { left: -size - PLUS_GAP, top: 0, width: size, height: size } : { left: 0, top: (corner ? -1 : 1) * (size + PLUS_GAP), width: size, height: size }}
          // The cursor and the focus stay in the editor, and on a phone its keyboard stays open. Without
          // its press, Safari sends no click: a finger inserts as it lifts.
          onPointerDown={(e) => {
            finger.current = e.pointerType === 'touch'
            e.preventDefault()
          }}
          onPointerUp={(e) => e.pointerType === 'touch' && openBelow(editor, pos)}
          onClick={() => !finger.current && openBelow(editor, pos)}
        >
          <Plus />
        </button>
        <div className="absolute inset-0">
          <MenuRoot open={menu === pos} onOpenChange={closeMenu}>
            {/* Where the menu opens from; the handle itself opens it on a click, so that it can be dragged. */}
            <MenuTrigger asChild>
              <span aria-hidden="true" aria-label={label} className="pointer-events-none absolute inset-0" />
            </MenuTrigger>
            <MenuContent align="start" onCloseAutoFocus={closeFocus}>
              <MenuItem icon={<Plus />} onSelect={act(() => openBelow(editor, pos))}>
                {t('editor.block.insertBelow')}
              </MenuItem>
              <MenuSeparator />
              {options.length > 0 && (
                <MenuSub>
                  <MenuSubTrigger icon={<Repeat />}>{t('editor.block.turnInto')}</MenuSubTrigger>
                  <MenuSubContent>
                    {options.map((option) => (
                      <MenuItem
                        key={option}
                        icon={<span className="w-[15px] text-center font-mono text-[11px] text-ink-3">{TURN_ICONS[option]}</span>}
                        current={option === current}
                        disabled={option === current}
                        shortcut={MARKDOWN_SHORTCUTS[option]}
                        onSelect={act(() => turnBlock(editor, pos, option))}
                      >
                        {t(`editor.slash.${option}.title`)}
                      </MenuItem>
                    ))}
                  </MenuSubContent>
                </MenuSub>
              )}
              {callout !== null && (
                <MenuSub>
                  <MenuSubTrigger icon={<Info />}>{t('editor.callout.menu')}</MenuSubTrigger>
                  <MenuSubContent>
                    {/* Not an action that places the cursor: it goes back where it was, in the callout. */}
                    <CalloutTypeItems editor={editor} pos={callout} />
                  </MenuSubContent>
                </MenuSub>
              )}
              {node.type.name === 'codeBlock' && (
                <>
                  <MenuItem icon={<Code />} onSelect={() => (languages.current = pos)}>
                    {t('editor.block.language')}
                  </MenuItem>
                  <MenuItem icon={<ClipboardCopy />} onSelect={() => void copyCode(node.textContent)}>
                    {t('editor.code.copy')}
                  </MenuItem>
                </>
              )}
              <MenuItem icon={<Copy />} onSelect={act(() => duplicateBlock(editor, pos))}>
                {t('editor.block.duplicate')}
              </MenuItem>
              <MenuItem icon={<ArrowUp />} shortcut={`${MOD}${SHIFT}↑`} disabled={!canMove(editor.state.doc, pos, -1)} onSelect={act(() => moveBlock(editor, pos, -1))}>
                {t('editor.block.moveUp')}
              </MenuItem>
              <MenuItem icon={<ArrowDown />} shortcut={`${MOD}${SHIFT}↓`} disabled={!canMove(editor.state.doc, pos, 1)} onSelect={act(() => moveBlock(editor, pos, 1))}>
                {t('editor.block.moveDown')}
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Trash2 />} danger onSelect={act(() => deleteBlock(editor, pos))}>
                {t('editor.block.delete')}
              </MenuItem>
            </MenuContent>
          </MenuRoot>
          <button
            type="button"
            tabIndex={-1}
            draggable
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={menu === pos}
            title={t('editor.block.handleHint', { key: `${MOD}/` })}
            className="grid size-full cursor-grab place-items-center rounded-[6px] text-ink-4 transition-colors hover:bg-hover hover:text-ink-2 active:cursor-grabbing aria-expanded:bg-accent-soft aria-expanded:text-accent [&_svg]:size-4"
            // A finger's tap keeps the cursor in the editor, and the phone's keyboard open. Without its
            // press, Safari sends no click: the finger opens the menu as it lifts.
            onPointerDown={(e) => {
              finger.current = e.pointerType === 'touch'
              if (finger.current) e.preventDefault()
              else if (e.button === 0 && !e.ctrlKey) held.current = true
            }}
            onPointerUp={(e) => e.pointerType === 'touch' && openMenu(pos)}
            onClick={() => !finger.current && openMenu(pos)}
            onDragStart={(e) => drag(e, pos)}
            onDragEnd={() => {
              held.current = false
              editor.view.dragging = null
            }}
          >
            <GripVertical />
          </button>
        </div>
      </div>
    )
  }
}
