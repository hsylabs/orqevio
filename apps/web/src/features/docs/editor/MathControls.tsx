import type { Editor } from '@tiptap/core'
import { NodeSelection, type Transaction } from '@tiptap/pm/state'
import { useEditorState } from '@tiptap/react'
import { type FocusEvent, type KeyboardEvent, useEffect, useId, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isConverting } from '../../../lib/ime'
import { drawMath, insertMath, mathError, mathStorage, placeAfter, setMath } from './math'
import { changeOf } from './own-step'

const GAP = 8

/**
 * The formula being written: the one at `pos`, or a new one that goes in there (`fresh`); `opened`,
 * its source when its field opened, by which it is found again; `key`, which field this is.
 */
type Writing = { pos: number; display: boolean; fresh: boolean; text: string; opened: string; key: number }

const isMath = (name: string | undefined) => name === 'inlineMath' || name === 'blockMath'
let opening = 0

/** The formula `writing` is for in `doc` after a change that replaced it whole: the same one, nearest to where it was. */
function sameFormula(doc: Transaction['doc'], writing: Writing) {
  let best: number | null = null
  doc.descendants((node, pos) => {
    if (node.type.name === (writing.display ? 'blockMath' : 'inlineMath') && node.attrs.latex === writing.opened && (best === null || Math.abs(pos - writing.pos) < Math.abs(best - writing.pos))) best = pos
  })
  return best
}

/**
 * The field where a formula is written, as in Notion: under the formula, its LaTeX source and how it
 * looks as it is typed. A click on a formula opens it (a tap on a phone), Enter with one selected
 * too; for a new one, the «/» menu and Ctrl+Shift+E. Enter saves, Escape leaves it as it was, and
 * going elsewhere saves it.
 */
export function MathControls({ editor }: { editor: Editor }) {
  const { t } = useTranslation('docs')
  const root = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const preview = useRef<HTMLDivElement>(null)
  const errorId = useId()
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const { selection } = e.state
      const selected = selection instanceof NodeSelection && isMath(selection.node.type.name)
      return { selected: selected && e.isEditable && e.isFocused }
    },
  })
  /** Also in a ref, read when the field loses the focus and as the page changes. */
  const [writing, setWritingState] = useState<Writing | null>(null)
  const writingRef = useRef<Writing | null>(null)
  const setWriting = (value: Writing | null) => {
    writingRef.current = value
    setWritingState(value)
  }
  const [, redraw] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    const storage = mathStorage(editor)
    if (!storage) return
    storage.edit = (pos) => {
      const node = editor.state.doc.nodeAt(pos)
      if (!node || !isMath(node.type.name)) return
      const latex = String(node.attrs.latex ?? '')
      setWriting({ pos, display: node.type.name === 'blockMath', fresh: false, text: latex, opened: latex, key: ++opening })
    }
    storage.create = (pos, display) => setWriting({ pos, display, fresh: true, text: '', opened: '', key: ++opening })
    let frame = 0
    const later = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(redraw)
    }
    // The formula being written follows the page as it changes (another tab, an agent). A page
    // read again is replaced whole: the formula is found again by its source, what was typed kept.
    // Its field closes, unsaved, only if the formula went.
    const changed = (event: { transaction: Transaction; appendedTransactions?: Transaction[] }) => {
      const change = changeOf(event)
      const current = writingRef.current
      if (change.docChanged && current) {
        if (current.fresh) {
          // A new one goes where it was asked for, or as near as the page now allows (insertMath).
          const moved = change.mapping.mapResult(current.pos, -1)
          setWriting({ ...current, pos: Math.min(moved.pos, change.doc.content.size) })
        } else {
          const moved = [change.mapping.mapResult(current.pos, 1), change.mapping.mapResult(current.pos, -1)].find(
            (result) => !result.deletedAcross && isMath(change.doc.nodeAt(result.pos)?.type.name),
          )
          const at = moved ? moved.pos : sameFormula(change.doc, current)
          setWriting(at === null ? null : { ...current, pos: at })
        }
      }
      later()
    }
    editor.on('transaction', changed)
    window.addEventListener('scroll', later, true)
    window.addEventListener('resize', later)
    return () => {
      storage.edit = null
      storage.create = null
      cancelAnimationFrame(frame)
      editor.off('transaction', changed)
      window.removeEventListener('scroll', later, true)
      window.removeEventListener('resize', later)
    }
  }, [editor])

  // The field takes the focus as it opens, its cursor at the end; only then, wherever the formula moves.
  useEffect(() => {
    const el = field.current
    if (!writing || !el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [writing?.key])

  // How it looks, as it is typed; and the field as tall as what it holds, up to a point.
  useLayoutEffect(() => {
    if (writing && preview.current) drawMath(preview.current, writing.text, writing.display)
    const el = field.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, 192)}px`
  }, [writing?.text, writing?.display, writing?.key])

  const anchor = writing ? anchorOf(writing) : null
  const base = root.current?.getBoundingClientRect()
  const error = writing?.text.trim() ? mathError(writing.text, writing.display) : null

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 z-30 print:hidden">
      <div aria-live="polite" className="sr-only">
        {state.selected && !writing ? t('editor.math.hint') : ''}
      </div>
      {writing && anchor && base && renderField(writing, anchor, base)}
    </div>
  )

  /** Where the formula is on the screen, or where a new one goes. */
  function anchorOf(current: Writing): DOMRect | null {
    try {
      if (!current.fresh) {
        const dom = editor.view.nodeDOM(current.pos)
        return dom instanceof HTMLElement ? dom.getBoundingClientRect() : null
      }
      const at = editor.view.coordsAtPos(Math.min(current.pos, editor.state.doc.content.size))
      return new DOMRect(at.left, at.top, 0, at.bottom - at.top)
    } catch {
      return null
    }
  }

  function renderField(current: Writing, at: DOMRect, base: DOMRect) {
    const height = box.current?.offsetHeight ?? 160
    const width = Math.min(420, base.width - 8)
    // Under the formula, or above it where there's no room under it on the screen.
    const below = at.bottom + GAP + height <= window.innerHeight || at.top - GAP - height < 0
    const top = below ? at.bottom - base.top + GAP : at.top - base.top - GAP - height
    const left = Math.max(0, Math.min(at.left - base.left, base.width - width))

    /** Saves it (or, empty, takes it away) and goes back to the editor, unless the focus is going elsewhere. */
    function save(back = true) {
      const done = writingRef.current
      // Cleared before the focus moves: the field's blur, on the way, must find nothing to save.
      setWriting(null)
      if (!done) return
      if (done.fresh) {
        if (!insertMath(editor, done.pos, done.text, done.display, { focus: back }) && back) editor.chain().focus(undefined, { scrollIntoView: false }).setTextSelection(done.pos).run()
      } else if (!setMath(editor, done.pos, done.text, { focus: back }) && back) placeAfter(editor, done.pos)
    }

    /** Leaves it as it was, back in the editor where it was. */
    function cancel() {
      const done = writingRef.current
      setWriting(null)
      if (!done) return
      if (done.fresh) editor.chain().focus(undefined, { scrollIntoView: false }).setTextSelection(done.pos).run()
      else placeAfter(editor, done.pos)
    }

    function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
      if (isConverting(event)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
      } else if (event.key === 'Enter' && !(event.shiftKey && current.display)) {
        event.preventDefault()
        save()
      }
    }

    // Leaving it for something else on the page saves it, as Enter does, without taking the focus back.
    function onBlur(event: FocusEvent<HTMLDivElement>) {
      if (event.relatedTarget instanceof Node && box.current?.contains(event.relatedTarget)) return
      // Another window (to copy a formula from it): the focus comes back here with the window.
      if (!document.hasFocus()) return
      if (writingRef.current) save(false)
    }

    return (
      <div
        ref={box}
        role="dialog"
        aria-label={t('editor.math.dialog')}
        // Its Escape goes back to the editor, and doesn't close the card or dialog it is in.
        data-own-escape
        onBlur={onBlur}
        // A click keeps the focus in the field.
        onMouseDown={(e) => e.target !== field.current && e.preventDefault()}
        className="animate-pop pointer-events-auto absolute flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-2 shadow-lg"
        style={{ top, left, width }}
      >
        <textarea
          ref={field}
          value={current.text}
          rows={current.display ? 3 : 1}
          aria-label={t('editor.math.field')}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          placeholder={t('editor.math.placeholder')}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => setWriting({ ...current, text: e.target.value })}
          onKeyDown={onKeyDown}
          className="max-h-48 min-h-8 w-full resize-none rounded-[8px] bg-sunken px-2 py-1.5 font-mono text-[13px] leading-[1.5] text-ink outline-none placeholder:text-ink-3"
        />
        <div aria-label={t('editor.math.preview')} role="img" className="orq-math-preview max-h-40 overflow-auto px-1 text-ink" ref={preview} />
        {error && (
          <p id={errorId} className="px-1 text-[12px] leading-snug text-danger">
            {t('editor.math.error')}: {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="px-1 text-[11.5px] leading-snug text-ink-3">{t(current.display ? 'editor.math.keysBlock' : 'editor.math.keysInline')}</span>
          <button
            type="button"
            onClick={() => save()}
            className="h-7 shrink-0 rounded-[7px] bg-accent px-3 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90"
          >
            {t('editor.math.done')}
          </button>
        </div>
      </div>
    )
  }
}
