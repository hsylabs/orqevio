import type { Editor } from '@tiptap/core'
import { type EditorState, NodeSelection, TextSelection, type Transaction } from '@tiptap/pm/state'
import { useEditorState } from '@tiptap/react'
import { Captions, ImageUpscale } from 'lucide-react'
import { type ComponentProps, type KeyboardEvent, useEffect, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../lib/cn'
import { isConverting } from '../../../lib/ime'
import { setImageCaption, setImageWidth } from './image'
import { changeOf } from './own-step'

const GAP = 8
/** The widths offered on the bar, as shares of the line. */
const WIDTHS = [25, 50, 75, 100]

/** The image the bar is for: the one selected, or the one alone on the line with the cursor. */
export function imageAt(state: EditorState): number | null {
  const { selection } = state
  if (selection instanceof NodeSelection) return selection.node.type.name === 'image' ? selection.from : null
  if (!(selection instanceof TextSelection) || !selection.empty) return null
  const { $from } = selection
  const line = $from.parent
  if (line.type.name !== 'paragraph' || line.childCount !== 1 || line.firstChild!.type.name !== 'image') return null
  return $from.start()
}

/**
 * The bar of an image, as in Notion: its width (a share of the line, or its own) and its caption.
 * Above the image selected or alone on the line with the cursor, also with the keyboard (Alt+F10)
 * and on a phone. Dragging its edge gives it any width (image.ts).
 */
export function ImageControls({ editor }: { editor: Editor }) {
  const { t, i18n } = useTranslation('docs')
  const root = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({ pos: e.isEditable ? imageAt(e.state) : null, focused: e.isFocused }),
  })
  /** The caption being written, and for which image; also in a ref, read when its field loses the focus. */
  const [caption, setCaptionState] = useState<Caption | null>(null)
  const captionRef = useRef<Caption | null>(null)
  const setCaption = (value: Caption | null) => {
    captionRef.current = value
    setCaptionState(value)
  }
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  /** Where the page scrolls: the bar stays in view there. */
  const scroller = useRef<HTMLElement | null>(null)

  // Placed over the editor, the bar follows the image as the page moves.
  useEffect(() => {
    let frame = 0
    const later = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(redraw)
    }
    // The caption being written follows its image as the page changes (another tab, an agent); it
    // closes, unsaved, if the image went.
    const changed = (event: { transaction: Transaction; appendedTransactions?: Transaction[] }) => {
      const change = changeOf(event)
      const writing = captionRef.current
      if (change.docChanged && writing) {
        const moved = change.mapping.mapResult(writing.pos, -1)
        // A page read again is replaced whole: its image is found again by its address, the nearest one.
        // An image deleted on its own takes its caption with it, even with a copy of it elsewhere.
        const at = !moved.deletedAcross ? (change.doc.nodeAt(moved.pos)?.type.name === 'image' ? moved.pos : null) : sameImage(change.doc, writing)
        setCaption(at === null ? null : { ...writing, pos: at })
      }
      later()
    }
    // Alt+F10 goes to the bar, as for a table (whose bar it leaves the key to, in a cell); Escape comes back.
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'F10' || !event.altKey || event.defaultPrevented || imageAt(editor.state) === null) return
      event.preventDefault()
      const first = () => bar.current?.querySelector<HTMLButtonElement>('button')?.focus()
      if (bar.current) first()
      else requestAnimationFrame(() => requestAnimationFrame(first))
    }
    editor.on('transaction', changed)
    window.addEventListener('scroll', later, true)
    window.addEventListener('resize', later)
    const observer = new ResizeObserver(later)
    observer.observe(editor.view.dom)
    editor.view.dom.addEventListener('keydown', key)
    let el = root.current?.parentElement ?? null
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement
    scroller.current = el
    return () => {
      cancelAnimationFrame(frame)
      editor.off('transaction', changed)
      window.removeEventListener('scroll', later, true)
      window.removeEventListener('resize', later)
      observer.disconnect()
      editor.view.dom.removeEventListener('keydown', key)
    }
  }, [editor])

  // The caption's field takes the focus as it opens.
  useEffect(() => {
    if (caption) field.current?.focus()
  }, [caption !== null])

  // A caption whose image is gone (the page replaced) closes: the bar is then for the selection again.
  useEffect(() => {
    if (caption && editor.state.doc.nodeAt(caption.pos)?.type.name !== 'image') setCaption(null)
  })

  const inside = state.focused || Boolean(root.current?.contains(document.activeElement))
  const pos = caption?.pos ?? (inside ? state.pos : null)
  const node = pos !== null ? editor.state.doc.nodeAt(pos) : null
  const image = node?.type.name === 'image' ? node : null

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 z-30 print:hidden">
      <div aria-live="polite" className="sr-only">
        {image && !caption ? t('editor.image.hint') : ''}
      </div>
      {image && pos !== null && renderBar(pos)}
    </div>
  )

  function renderBar(pos: number) {
    let dom: Node | null = null
    try {
      dom = editor.view.nodeDOM(pos)
    } catch {
      return null
    }
    const base = root.current?.getBoundingClientRect()
    if (!(dom instanceof HTMLElement) || !base) return null
    const box = dom.getBoundingClientRect()
    const height = bar.current?.offsetHeight ?? 36
    // Above the image, kept in view while any of it is: a tall picture scrolled half out has it at its top.
    const viewTop = Math.max(0, scroller.current?.getBoundingClientRect().top ?? 0) + GAP
    const top = Math.min(Math.max(box.top - height - GAP, viewTop), box.bottom - height)
    const width = (image!.attrs.width as string | null) ?? null
    const percent = new Intl.NumberFormat(i18n.language, { style: 'percent' })

    /** Back to the editor, its cursor or selection as it was: a cursor next to the image stays a cursor. */
    function back() {
      editor.commands.focus(undefined, { scrollIntoView: false })
    }

    function saveCaption(done: 'save' | 'cancel') {
      // Read and cleared before the focus moves: its field's blur, on the way, must find nothing to save.
      const writing = captionRef.current
      setCaption(null)
      if (writing && done === 'save') setImageCaption(editor, writing.pos, writing.text)
      back()
    }

    function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      if (event.target === field.current) return
      if (event.key === 'Escape' && !isConverting(event)) {
        event.preventDefault()
        back()
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
        aria-label={t('editor.image.toolbar')}
        // Its Escape goes back to the image, and doesn't close the card or dialog it is in.
        data-own-escape
        aria-keyshortcuts="Alt+F10"
        onKeyDown={onKeyDown}
        onFocus={redraw}
        onBlur={redraw}
        // A click keeps the cursor in the editor, on a phone the keyboard too; not in the caption's field.
        onMouseDown={(e) => e.target !== field.current && e.preventDefault()}
        className="animate-pop pointer-events-auto absolute flex max-w-[calc(100%-8px)] flex-wrap items-center gap-0.5 rounded-[12px] border border-line bg-surface p-1 shadow-lg"
        style={{ top: top - base.top, left: Math.max(0, box.left - base.left) }}
      >
        {WIDTHS.map((share) => {
          const label = percent.format(share / 100)
          return (
            <Tool key={share} label={t('editor.image.width', { size: label })} active={width === `${share}%`} onClick={() => setImageWidth(editor, pos, `${share}%`)}>
              <span className="px-0.5 text-[12.5px] font-medium tabular-nums">{label}</span>
            </Tool>
          )
        })}
        <Tool label={t('editor.image.original')} active={!width} onClick={() => setImageWidth(editor, pos, null)}>
          <ImageUpscale />
        </Tool>
        <span className="mx-0.5 h-5 w-px bg-line" />
        <Tool
          label={t('editor.image.caption')}
          active={Boolean(image!.attrs.title) || caption !== null}
          aria-expanded={caption !== null}
          onClick={() => (caption ? saveCaption('save') : setCaption({ pos, src: String(image!.attrs.src ?? ''), text: String(image!.attrs.title ?? '') }))}
        >
          <Captions />
        </Tool>
        {caption && (
          <input
            ref={field}
            value={caption.text}
            aria-label={t('editor.image.caption')}
            placeholder={t('editor.image.captionPlaceholder')}
            onChange={(e) => setCaption({ ...caption, text: e.target.value })}
            onKeyDown={(e) => {
              if (isConverting(e)) return
              if (e.key === 'Enter') {
                e.preventDefault()
                saveCaption('save')
              } else if (e.key === 'Escape') {
                e.preventDefault()
                saveCaption('cancel')
              }
            }}
            // Leaving it for something else saves it, as Enter does, without taking the focus back.
            onBlur={() => {
              const writing = captionRef.current
              if (!writing) return
              setCaption(null)
              setImageCaption(editor, writing.pos, writing.text)
            }}
            className="ml-0.5 h-7 w-[min(260px,60vw)] min-w-0 rounded-[7px] bg-sunken px-2 text-[13px] outline-none placeholder:text-ink-3"
          />
        )}
      </div>
    )
  }
}

type Caption = { pos: number; src: string; text: string }

/** The image with the caption's address nearest to where it was, or null if there is none. */
function sameImage(doc: EditorState['doc'], caption: Caption) {
  let best: number | null = null
  doc.descendants((node, pos) => {
    if (node.type.name === 'image' && String(node.attrs.src ?? '') === caption.src && (best === null || Math.abs(pos - caption.pos) < Math.abs(best - caption.pos))) best = pos
  })
  return best
}

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
