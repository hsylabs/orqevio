import type { Editor } from '@tiptap/core'
import { type EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import { useEditorState } from '@tiptap/react'
import { Captions, ImageUpscale } from 'lucide-react'
import { type ComponentProps, type KeyboardEvent, useEffect, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../lib/cn'
import { isConverting } from '../../../lib/ime'
import { setImageCaption, setImageWidth } from './image'

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
  /** The caption being written, and for which image. */
  const [caption, setCaption] = useState<{ pos: number; text: string } | null>(null)
  const [, redraw] = useReducer((n: number) => n + 1, 0)

  // Placed over the editor, the bar follows the image as the page moves.
  useEffect(() => {
    let frame = 0
    const later = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(redraw)
    }
    // Alt+F10 goes to the bar, as for a table; Escape comes back.
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'F10' || !event.altKey || imageAt(editor.state) === null) return
      event.preventDefault()
      const first = () => bar.current?.querySelector<HTMLButtonElement>('button')?.focus()
      if (bar.current) first()
      else requestAnimationFrame(() => requestAnimationFrame(first))
    }
    editor.on('transaction', later)
    window.addEventListener('scroll', later, true)
    window.addEventListener('resize', later)
    const observer = new ResizeObserver(later)
    observer.observe(editor.view.dom)
    editor.view.dom.addEventListener('keydown', key)
    return () => {
      cancelAnimationFrame(frame)
      editor.off('transaction', later)
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
    const top = Math.max(box.top - height - GAP, base.top - height - GAP)
    const width = (image!.attrs.width as string | null) ?? null
    const percent = new Intl.NumberFormat(i18n.language, { style: 'percent' })

    /** Back to the editor, with the image selected if it is still there. */
    function back() {
      const chain = editor.chain().focus(undefined, { scrollIntoView: false })
      ;(editor.state.doc.nodeAt(pos)?.type.name === 'image' ? chain.setNodeSelection(pos) : chain).run()
    }

    function saveCaption(done: 'save' | 'cancel') {
      const writing = caption
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
          onClick={() => (caption ? saveCaption('save') : setCaption({ pos, text: String(image!.attrs.title ?? '') }))}
        >
          <Captions />
        </Tool>
        {caption && (
          <input
            ref={field}
            value={caption.text}
            aria-label={t('editor.image.caption')}
            placeholder={t('editor.image.captionPlaceholder')}
            onChange={(e) => setCaption({ pos: caption.pos, text: e.target.value })}
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
              if (!caption) return
              setCaption(null)
              setImageCaption(editor, caption.pos, caption.text)
            }}
            className="ml-0.5 h-7 w-[min(260px,60vw)] min-w-0 rounded-[7px] bg-sunken px-2 text-[13px] outline-none placeholder:text-ink-3"
          />
        )}
      </div>
    )
  }
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
