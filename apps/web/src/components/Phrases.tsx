import i18n from 'i18next'
import { Fragment, type MouseEvent, type PointerEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../lib/cn'
import { type Parse, cachedPhrases, loadPhrases, nativePhrases, onPhraseParser, phraseParser, rememberPhrases } from '../lib/phrases'

/*
 * Japanese titles broken between their phrases, never inside a word ("ござい|ます"). Chromium tells
 * phrases apart itself (`word-break: auto-phrase`, see `.orq-phrases` in app.css). Elsewhere BudouX
 * does (see lib/phrases.ts): the title is split into its phrases, with a place to break (<wbr>)
 * between them.
 */

/** Japanese letters: a title with any of them is split into phrases. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/u
/** Letters and digits of scripts that put spaces between words: BudouX's places to break between two of them fall inside a word or a number ("202|6年"). */
const SPACED = /[\p{L}\p{N}]/u
const spaced = (char: string | undefined) => char !== undefined && SPACED.test(char) && !CJK.test(char)
/** Characters as people see them: an emoji family, a heart with its style or a letter with its accent is one. */
const graphemes = new Intl.Segmenter('ja', { granularity: 'grapheme' })

/**
 * The phrases BudouX finds in `text`, joined again where its place to break would cut a word or a
 * number written in a spaced script, or a character drawn from several code points. Every
 * character stays, in order.
 */
export function splitPhrases(text: string, parse: Parse): string[] {
  const starts = new Set(Array.from(graphemes.segment(text), (g) => g.index))
  const phrases: string[] = []
  let offset = 0
  for (const phrase of parse(text)) {
    const last = phrases.at(-1)
    if (last !== undefined && (!starts.has(offset) || (spaced([...last].at(-1)) && spaced([...phrase][0])))) phrases[phrases.length - 1] = last + phrase
    else phrases.push(phrase)
    offset += phrase.length
  }
  return phrases
}

const phrasesOf = (text: string, parse: Parse) => cachedPhrases(text) ?? rememberPhrases(text, splitPhrases(text, parse))

/**
 * How a title shows here: `native` when the browser breaks it between phrases itself, its phrases
 * when BudouX has found them, and null when it is not Japanese, or BudouX isn't there yet (it breaks
 * as the browser breaks it until then). With `cache: false` its phrases are not kept once shown
 * (a title from the vault, which must not outlive it).
 */
function usePhrases(text: string, { cache = true }: { cache?: boolean } = {}): 'native' | string[] | null {
  // Shown again in another language, it is read again.
  useTranslation()
  const japanese = i18n.resolvedLanguage === 'ja' && CJK.test(text)
  const parse = useSyncExternalStore(onPhraseParser, phraseParser, phraseParser)
  useEffect(() => {
    if (japanese) loadPhrases()
  }, [japanese])
  if (!japanese) return null
  if (nativePhrases) return 'native'
  if (!parse) return null
  return cache ? phrasesOf(text, parse) : splitPhrases(text, parse)
}

/** Part of a text, or nothing for none of it. */
const part = (text: string, from: number, to?: number) => text.slice(from, to) || null

/** A text as its phrases (or whole), with a place to break (<wbr>) between them and the part `italic` slanted. */
function pieces(text: string, phrases: string[] | null, italic?: readonly [number, number]) {
  let offset = 0
  return (phrases ?? [text]).map((phrase, i) => {
    const start = offset
    offset += phrase.length
    const from = Math.max(italic?.[0] ?? 0, start) - start
    const to = Math.min(italic?.[1] ?? 0, offset) - start
    return (
      // The phrases of one text, always in the same order.
      <Fragment key={i}>
        {i > 0 && <wbr />}
        {from < to ? (
          <>
            {part(phrase, 0, from)}
            <span className="italic">{phrase.slice(from, to)}</span>
            {part(phrase, to)}
          </>
        ) : (
          phrase
        )}
      </Fragment>
    )
  })
}

/**
 * A title that breaks between its phrases when it is Japanese; any other text as it is. `italic`
 * slants a part of it (from, to), as a name in a sentence (see `withoutMarks`).
 */
export function Phrases({ text, cache, italic }: { text: string; cache?: boolean; italic?: readonly [number, number] }) {
  const phrases = usePhrases(text, { cache })
  if (phrases === null) return italic ? pieces(text, null, italic) : text
  return <span className="orq-phrases">{pieces(text, phrases === 'native' ? null : phrases, italic)}</span>
}

/**
 * A translated sentence without the tag marking a part of it ("Good morning, <name>Ana</name>."),
 * and where that part is, to slant it with `Phrases`.
 */
export function withoutMarks(sentence: string, tag = 'name'): [string, [number, number] | undefined] {
  const [open, close] = [`<${tag}>`, `</${tag}>`]
  const start = sentence.indexOf(open)
  const end = sentence.lastIndexOf(close)
  if (start < 0 || end < start + open.length) return [sentence, undefined]
  const part = sentence.slice(start + open.length, end)
  return [sentence.slice(0, start) + part + sentence.slice(end + close.length), [start, start + part.length]]
}

/** The place in `root`'s text nearest to a point on screen, counted in UTF-16 units, never inside a character. */
function offsetAt(root: HTMLElement, x: number, y: number) {
  let best = { offset: 0, distance: Infinity }
  let offset = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? ''
    for (const { index, segment } of graphemes.segment(text)) {
      range.setStart(node, index)
      range.setEnd(node, index + segment.length)
      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue
      const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0
      const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
      // On the line first, then along it.
      const distance = dy * 10_000 + dx
      if (distance < best.distance) best = { offset: offset + index + (x > rect.left + rect.width / 2 ? segment.length : 0), distance }
    }
    offset += text.length
  }
  return best.offset
}

/**
 * Sizes a title's textarea to its text. It is a floor (`min-height`), not a height, so the textarea
 * still fills its grid cell when the title drawn over it (`usePhrasedField`) takes more lines.
 */
export function fitTitle(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.minHeight = '0'
  el.style.height = '0'
  const needed = el.scrollHeight
  el.style.height = ''
  el.style.minHeight = `${needed}px`
}

/**
 * An editable title (a textarea) that, while it isn't being edited, shows broken between phrases
 * where only BudouX can tell them apart: the textarea stays in its place, unseen, so it is still
 * what is clicked, focused and read; the title drawn over it is for the eyes only. Both go in the
 * same grid cell, `[grid-area:1/1]`, with the same typography (`className`); the textarea fills the
 * cell (see `fitTitle`), so a click anywhere on the drawn title lands in it, at the character clicked.
 * While it is edited, the drawn title stays, unseen, as it was when editing began: the title keeps
 * its place on screen, and nothing is split while typing.
 */
export function usePhrasedField(text: string, className: string) {
  /** The title as it was when editing began, while it is edited. */
  const [editing, setEditing] = useState<string | null>(null)
  const phrases = usePhrases(editing ?? text)
  const drawn = useRef<HTMLDivElement>(null)
  /** Where the drawn title was clicked, for the caret to go there. */
  const clicked = useRef<number | null>(null)
  const phrased = Array.isArray(phrases)
  const shown = phrased && editing === null
  return {
    /** Whether the textarea is hidden under the title drawn over it. */
    hidden: shown,
    onFocus: () => setEditing(text),
    onBlur: () => setEditing(null),
    onPointerDown: (e: PointerEvent<HTMLTextAreaElement>) => {
      clicked.current = shown && drawn.current ? offsetAt(drawn.current, e.clientX, e.clientY) : null
    },
    onClick: (e: MouseEvent<HTMLTextAreaElement>) => {
      const el = e.currentTarget
      const at = clicked.current
      clicked.current = null
      // Not when the click chose some text.
      if (at !== null && el.selectionStart === el.selectionEnd) el.setSelectionRange(at, at)
    },
    overlay: phrased ? (
      <div ref={drawn} aria-hidden="true" className={cn('pointer-events-none orq-phrases whitespace-pre-wrap [grid-area:1/1]', className, editing !== null && 'invisible')}>
        {pieces(editing ?? text, phrases)}
      </div>
    ) : null,
  }
}
