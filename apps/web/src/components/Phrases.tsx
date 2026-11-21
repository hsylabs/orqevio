import { Children, Fragment, type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'
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
/** What can't start a character of its own: marks, variation selectors, joiners, keycaps, skin tones. */
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
 * as the browser breaks it until then).
 */
export function usePhrases(text: string): 'native' | string[] | null {
  // Shown again in another language, it is read again.
  useTranslation()
  const japanese = i18n.resolvedLanguage === 'ja' && JAPANESE.test(text)
  const ready = useSyncExternalStore(subscribe, () => parse !== null)
  useEffect(() => {
    if (japanese) load()
  }, [japanese])
  if (!japanese) return null
  if (native) return 'native'
  return ready && parse ? phrasesOf(text, parse) : null
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
export function Phrases({ text }: { text: string }) {
  const phrases = usePhrases(text)
  if (phrases === null) return text
  return <span className="orq-phrases">{phrases === 'native' ? text : withBreaks(phrases)}</span>
}

/** Phrases for a text that comes as children (a part of a translated sentence). */
export function PhrasesOf({ children }: { children?: ReactNode }) {
  return <Phrases text={Children.toArray(children).join('')} />
}

/**
 * An editable title (a textarea) that, while it isn't being edited, shows broken between phrases
 * where only BudouX can tell them apart: the textarea stays in its place, unseen, so it is still
 * what is clicked, focused and read; the title drawn over it is for the eyes only. Both go in the
 * same grid cell, `[grid-area:1/1]`, with the same typography (`className`).
 */
export function usePhrasedField(text: string, className: string) {
  const phrases = usePhrases(text)
  const [editing, setEditing] = useState(false)
  const shown = Array.isArray(phrases) && !editing
  return {
    /** Whether the textarea is hidden under the title drawn over it. */
    hidden: shown,
    onFocus: () => setEditing(true),
    onBlur: () => setEditing(false),
    overlay: shown ? (
      <div aria-hidden="true" className={cn('pointer-events-none orq-phrases [grid-area:1/1]', className)}>
        {withBreaks(phrases)}
      </div>
    ) : null,
  }
}
