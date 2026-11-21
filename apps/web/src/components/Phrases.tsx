import { Fragment, type MouseEvent, type PointerEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from 'i18next'
import { cn } from '../lib/cn'

/**
 * Japanese has no spaces: a title breaks between phrases, never inside a word ("ござい|ます").
 * Chromium tells phrases apart itself (`word-break: auto-phrase`, see `.orq-phrases` in app.css).
 * Elsewhere BudouX does, the same model Chromium's is based on: the title is split into its phrases,
 * with a place to break (<wbr>) between them. It loads only where the app is in Japanese and the
 * browser can't tell phrases apart.
 */
const native = typeof CSS !== 'undefined' && CSS.supports('word-break', 'auto-phrase')
/** Hiragana, katakana and the common kanji. */
const JAPANESE = /[぀-ヿ㐀-䶿一-鿿]/

type Parse = (text: string) => string[]
let parse: Parse | null = null
let loading: Promise<void> | null = null
const waiting = new Set<() => void>()
const cache = new Map<string, string[]>()
const CACHED = 2000

function load() {
  if (native || parse) return
  loading ??= import('budoux')
    .then(({ Parser, jaModel }) => {
      const parser = new Parser(jaModel)
      parse = (text) => parser.parse(text)
      for (const done of waiting) done()
    })
    // Without it, titles break as the browser breaks them; a later title tries again.
    .catch(() => {
      loading = null
    })
}
// As soon as the app is in Japanese, so the first board doesn't wait for it.
if (i18n.resolvedLanguage === 'ja') load()
i18n.on('languageChanged', (language) => language === 'ja' && load())

const subscribe = (done: () => void) => {
  waiting.add(done)
  return () => waiting.delete(done)
}

/** Letters and digits of scripts that put spaces between words: BudouX's places to break between two of them fall inside a word or a number ("202|6年"). */
const SPACED = /[\p{L}\p{N}]/u
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/u
const spaced = (char: string | undefined) => char !== undefined && SPACED.test(char) && !CJK.test(char)
/** What can't start a character of its own: marks, the zero-width joiner, variation selectors, keycaps, skin tones. */
const ATTACHED = /^[\p{M}‍︎️⃣\u{1f3fb}-\u{1f3ff}]/u
const graphemes = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('ja', { granularity: 'grapheme' }) : null

/**
 * The phrases BudouX finds in `text`, joined again where its place to break would cut a word or a
 * number written in a spaced script, or a character drawn from several code points (an emoji family,
 * a heart with its style). Every character stays, in order.
 */
export function splitPhrases(text: string, parse: Parse): string[] {
  const starts = graphemes ? new Set([...graphemes.segment(text)].map((g) => g.index)) : null
  const phrases: string[] = []
  let offset = 0
  for (const phrase of parse(text)) {
    const last = phrases.at(-1)
    const inside =
      last !== undefined &&
      (starts ? !starts.has(offset) : ATTACHED.test(phrase) || last.endsWith('‍') || (/[\ud800-\udbff]$/.test(last) && /^[\udc00-\udfff]/.test(phrase)))
    if (last !== undefined && (inside || (spaced([...last].at(-1)) && spaced([...phrase][0])))) phrases[phrases.length - 1] = last + phrase
    else phrases.push(phrase)
    offset += phrase.length
  }
  return phrases
}

function phrasesOf(text: string, parse: Parse) {
  let phrases = cache.get(text)
  if (!phrases) {
    phrases = splitPhrases(text, parse)
    if (cache.size >= CACHED) cache.delete(cache.keys().next().value!)
    cache.set(text, phrases)
  }
  return phrases
}

/**
 * How a title shows here: `native` when the browser breaks it between phrases itself, its phrases
 * when BudouX has found them, and null when it is not Japanese, or BudouX isn't there yet (it breaks
 * as the browser breaks it until then). With `cache: false` its phrases are not kept once shown
 * (a title from the vault, which must not outlive it).
 */
export function usePhrases(text: string, { cache = true }: { cache?: boolean } = {}): 'native' | string[] | null {
  // Shown again in another language, it is read again.
  useTranslation()
  const japanese = i18n.resolvedLanguage === 'ja' && JAPANESE.test(text)
  const ready = useSyncExternalStore(subscribe, () => parse !== null)
  useEffect(() => {
    if (japanese) load()
  }, [japanese])
  if (!japanese) return null
  if (native) return 'native'
  if (!ready || !parse) return null
  return cache ? phrasesOf(text, parse) : splitPhrases(text, parse)
}

const withBreaks = (phrases: string[]) =>
  phrases.map((phrase, i) => (
    // The phrases of one text, always in the same order.
    <Fragment key={i}>
      {i > 0 && <wbr />}
      {phrase}
    </Fragment>
  ))

/** A title that breaks between its phrases when it is Japanese; any other text as it is. */
export function Phrases({ text, cache }: { text: string; cache?: boolean }) {
  const phrases = usePhrases(text, { cache })
  if (phrases === null) return text
  return <span className="orq-phrases">{phrases === 'native' ? text : withBreaks(phrases)}</span>
}

/** The place in `root`'s text nearest to a point on screen, counted in characters. */
function offsetAt(root: HTMLElement, x: number, y: number) {
  let best = { offset: 0, distance: Infinity }
  let offset = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0
    for (let i = 0; i < length; i++) {
      range.setStart(node, i)
      range.setEnd(node, i + 1)
      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue
      const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0
      const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
      // On the line first, then along it.
      const distance = dy * 10_000 + dx
      if (distance < best.distance) best = { offset: offset + i + (x > rect.left + rect.width / 2 ? 1 : 0), distance }
    }
    offset += length
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
        {withBreaks(phrases)}
      </div>
    ) : null,
  }
}
