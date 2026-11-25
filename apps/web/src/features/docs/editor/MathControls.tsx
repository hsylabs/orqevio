import type { Editor } from '@tiptap/core'
import { NodeSelection, type Transaction } from '@tiptap/pm/state'
import { useEditorState } from '@tiptap/react'
import { type FocusEvent, type KeyboardEvent, useEffect, useId, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isConverting } from '../../../lib/ime'
import { drawMath, insertMath, mathError, mathStorage, placeAfter, setMath } from './math'
import { changeOf } from './own-step'

const GAP = 8

type Doc = Transaction['doc']

/**
 * The formula being written: the one at `pos`, or a new one that goes in there (`fresh`); `key`,
 * which field this is. How it is found again when the page is replaced whole (read again after
 * another tab or an agent saved it): one already there by its source and which of the formulas
 * with that source it is (`opened`, `nth`, `of`); a new one by the text of its line (`line`).
 */
type Writing = { pos: number; display: boolean; fresh: boolean; text: string; key: number; opened: string; nth: number; of: number; line: Line | null }
/** A line of text, which one it is among the document's, and a place in it. */
type Line = { text: string; index: number; offset: number }

const isMath = (name: string | undefined) => name === 'inlineMath' || name === 'blockMath'
let opening = 0

/** Where the formulas of a kind with a source are in `doc`, in order. */
function twins(doc: Doc, display: boolean, latex: string) {
  const found: number[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === (display ? 'blockMath' : 'inlineMath') && node.attrs.latex === latex) found.push(pos)
  })
  return found
}

/** The lines of text of `doc`, in order, with where each starts. */
function lines(doc: Doc) {
  const found: Array<{ pos: number; node: Doc }> = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    found.push({ pos, node })
    return false
  })
  return found
}

/** The line `pos` is in, to find it again. */
function lineAt(doc: Doc, pos: number): Line | null {
  const $pos = doc.resolve(Math.min(pos, doc.content.size))
  if (!$pos.parent.isTextblock) return null
  const start = $pos.before()
  return { text: $pos.parent.textContent, index: lines(doc).findIndex((line) => line.pos === start), offset: $pos.parentOffset }
}

/** The same line in `doc`, the nearest one with the same text, and the place in it; or null. */
function placeIn(doc: Doc, line: Line) {
  let best: { pos: number; node: Doc; distance: number } | null = null
  lines(doc).forEach((candidate, index) => {
    const distance = Math.abs(index - line.index)
    if (candidate.node.textContent === line.text && (!best || distance < best.distance)) best = { ...candidate, distance }
  })
  const found = best as { pos: number; node: Doc } | null
  return found ? found.pos + 1 + Math.min(line.offset, found.node.content.size) : null
}

/** The formula at `pos`, and which of those with its kind and source it is. */
function formulaAt(doc: Doc, pos: number, display: boolean, latex: string) {
  const all = twins(doc, display, latex)
  return { nth: all.indexOf(pos), of: all.length }
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
      const { doc } = editor.state
      const node = doc.nodeAt(pos)
      if (!node || !isMath(node.type.name)) return
      const latex = String(node.attrs.latex ?? '')
      const display = node.type.name === 'blockMath'
      setWriting({ pos, display, fresh: false, text: latex, key: ++opening, opened: latex, ...formulaAt(doc, pos, display, latex), line: null })
    }
    storage.create = (pos, display) =>
      setWriting({ pos, display, fresh: true, text: '', key: ++opening, opened: '', nth: -1, of: 0, line: lineAt(editor.state.doc, pos) })
    let frame = 0
    const later = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(redraw)
    }
    // The formula being written follows the page as it changes (another tab, an agent). When the
    // page is replaced whole, it is found again (see Writing), what was typed kept; if it can't be
    // told for sure, or it went, its field closes unsaved, rather than change another one.
    const changed = (event: { transaction: Transaction; appendedTransactions?: Transaction[] }) => {
      const change = changeOf(event)
      // What was typed meanwhile, which the last drawing may not have yet.
      const current = writingRef.current
      if (change.docChanged && current) {
        if (current.fresh) {
          const moved = change.mapping.mapResult(current.pos, -1)
          const at = moved.deletedAcross ? (current.line ? placeIn(change.doc, current.line) : null) : moved.pos
          setWriting(at === null ? null : { ...current, pos: at, line: lineAt(change.doc, at) })
        } else {
          // Followed through the change only to the same formula: at the page's start, what replaced
          // the page maps there too.
          const same = (pos: number) => {
            const node = change.doc.nodeAt(pos)
            return node?.type.name === (current.display ? 'blockMath' : 'inlineMath') && node.attrs.latex === current.opened
          }
          const moved = [change.mapping.mapResult(current.pos, 1), change.mapping.mapResult(current.pos, -1)].find(
            (result) => !result.deleted && same(result.pos),
          )
          const all = twins(change.doc, current.display, current.opened)
          const at = moved ? moved.pos : all.length === current.of ? (all[current.nth] ?? null) : null
          setWriting(at === null ? null : { ...current, pos: at, ...formulaAt(change.doc, at, current.display, current.opened) })
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
    const pos = Math.min(current.pos, editor.state.doc.content.size)
    try {
      if (!current.fresh) {
        const dom = editor.view.nodeDOM(pos)
        return dom instanceof HTMLElement ? dom.getBoundingClientRect() : null
      }
      const at = editor.view.coordsAtPos(pos)
      return new DOMRect(at.left, at.top, 0, at.bottom - at.top)
    } catch {
      // Where the browser can't tell the cursor's place (an empty line, a page still drawing): its line.
      try {
        const { node } = editor.view.domAtPos(pos)
        const line = node instanceof HTMLElement ? node : node.parentElement
        return line?.getBoundingClientRect() ?? null
      } catch {
        return null
      }
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
          // On the latest state: the page may have moved the formula since this was drawn.
          // A field the page just closed takes nothing more.
          onChange={(e) => writingRef.current && setWriting({ ...writingRef.current, text: e.target.value })}
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
