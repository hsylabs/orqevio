import type { Editor } from '@tiptap/core'
import { NodeSelection, Selection, type SelectionBookmark, type Transaction } from '@tiptap/pm/state'
import { useEditorState } from '@tiptap/react'
import { ArrowDown, ArrowUp, Copy, GripVertical, Repeat, Trash2 } from 'lucide-react'
import { type DragEvent, useEffect, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isMac } from '../../../components/ui/Kbd'
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from '../../../components/ui/Menu'
import { cn } from '../../../lib/cn'
import { TURN_ICONS, blockAt, canMove, deleteBlock, duplicateBlock, isItem, moveBlock, turnBlock, turns } from './block-commands'

const WIDTH = 18
const HEIGHT = 24
const GAP = 6
/** Room for a list item's bullet or number, left of its text. */
const MARKER = 20

const MOD = isMac ? '⌘' : 'Ctrl+'
const SHIFT = isMac ? '⇧' : 'Shift+'

/**
 * The handle of a block, as in Notion: ⋮⋮ left of the block under the pointer, or of the block with
 * the cursor on a phone. Dragged, it moves the block; clicked (or Ctrl+/), it opens the block's menu.
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
  const [hover, setHover] = useState<number | null>(null)
  const [menu, setMenu] = useState<number | null>(null)
  /** The block whose menu is closing: its handle stays until the menu has put the focus back. */
  const [closing, setClosing] = useState<number | null>(null)
  const menuRef = useRef<number | null>(null)
  menuRef.current = menu
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const leaving = useRef<ReturnType<typeof setTimeout>>(undefined)
  /** Whether a handle is pressed or dragged: it stays where it is, whatever the pointer goes over. */
  const held = useRef(false)
  /** Whether the handle was pressed by a finger, which opens the menu as it lifts, not with a click. */
  const finger = useRef(false)
  /** Whether a menu item ran, and the selection to bring back if none did. */
  const acted = useRef(false)
  const before = useRef<SelectionBookmark | null>(null)

  // The handle follows its block as the page changes, scrolls or resizes.
  useEffect(() => {
    let frame = 0
    const later = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(redraw)
    }
    const changed = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged) {
        // An agent or another tab can change the page while the menu is open: it follows its block.
        before.current = before.current?.map(transaction.mapping) ?? null
        const open = menuRef.current
        if (open !== null) {
          const moved = transaction.mapping.mapResult(open, 1)
          if (moved.deleted || !transaction.doc.nodeAt(moved.pos)) setMenu(null)
          else setMenu(moved.pos)
        }
        setHover(null)
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
      // The block at the pointer's height, also from the margin left of the text.
      const box = dom.getBoundingClientRect()
      const at = editor.view.posAtCoords({ left: Math.min(Math.max(event.clientX, box.left + 1), box.right - 1), top: event.clientY })
      const block = at && blockAt(editor.state.doc, at.inside >= 0 ? at.inside : at.pos)
      if (!block) return leave()
      stay()
      if (menuRef.current === null) setHover(block.pos)
    }
    // Ctrl+/ (⌘/) opens the menu of the block with the cursor; Escape closes it and comes back.
    const key = (event: KeyboardEvent) => {
      if (event.key !== '/' || !(isMac ? event.metaKey : event.ctrlKey) || event.altKey || event.shiftKey || !editor.isEditable) return
      const block = blockAt(editor.state.doc, editor.state.selection.from)
      if (!block) return
      event.preventDefault()
      openMenu(block.pos)
    }
    const release = () => (held.current = false)
    dom.addEventListener('pointermove', move)
    dom.addEventListener('pointerleave', leave)
    dom.addEventListener('keydown', key)
    window.addEventListener('pointerup', release)
    return () => {
      window.removeEventListener('pointerup', release)
      dom.removeEventListener('pointermove', move)
      dom.removeEventListener('pointerleave', leave)
      dom.removeEventListener('keydown', key)
      clearTimeout(leaving.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  function stay() {
    clearTimeout(leaving.current)
  }
  function leave() {
    clearTimeout(leaving.current)
    leaving.current = setTimeout(() => !held.current && setHover(null), 250)
  }

  /** The menu acts on its block, selected while it is open to show which one. */
  function openMenu(pos: number) {
    before.current = editor.state.selection.getBookmark()
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)))
    setMenu(pos)
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
    acted.current = false
    before.current = null
    setClosing(null)
    setHover(null)
    if (ran) return editor.view.focus()
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
    const top = (line.top + line.bottom) / 2 - HEIGHT / 2 - base.top
    const left = box.left - (isItem(node) ? MARKER : 0) - WIDTH - GAP - base.left
    const { current, options } = turns(editor.state.doc, pos)
    const label = t('editor.block.handle')

    return (
      <div className={cn('absolute', live)} style={{ top, left, width: WIDTH, height: HEIGHT }} onPointerEnter={stay} onPointerLeave={leave}>
        <MenuRoot open={menu === pos} onOpenChange={closeMenu}>
          {/* Where the menu opens from; the handle itself opens it on a click, so that it can be dragged. */}
          <MenuTrigger asChild>
            <span aria-hidden="true" className="pointer-events-none absolute inset-0" />
          </MenuTrigger>
          <MenuContent align="start" onCloseAutoFocus={closeFocus}>
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
                      onSelect={act(() => turnBlock(editor, pos, option))}
                    >
                      {t(`editor.slash.${option}.title`)}
                    </MenuItem>
                  ))}
                </MenuSubContent>
              </MenuSub>
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
          className="grid size-full cursor-grab place-items-center rounded-[6px] text-ink-4 transition-colors hover:bg-hover hover:text-ink-2 active:cursor-grabbing aria-expanded:bg-accent-soft aria-expanded:text-accent [&_svg]:size-[15px]"
          // A finger's tap keeps the cursor in the editor, and the phone's keyboard open. Without its
          // press, Safari sends no click: the finger opens the menu as it lifts.
          onPointerDown={(e) => {
            finger.current = e.pointerType === 'touch'
            if (finger.current) e.preventDefault()
            else held.current = true
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
    )
  }
}
