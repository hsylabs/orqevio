import { Fragment, useEffect, useSyncExternalStore } from 'react'
import { currentLocale } from '../i18n'

/**
 * Japanese has no spaces: a title breaks between phrases, never inside a word ("ござい|ます").
 * Chromium tells phrases apart itself (`word-break: auto-phrase`, see `.orq-phrases` in app.css).
 * Elsewhere BudouX does, the same model Chromium's is based on: the title is split into its phrases,
 * with a place to break (<wbr>) between them. It loads only when a Japanese title needs it there.
 */
const native = typeof CSS !== 'undefined' && CSS.supports('word-break', 'auto-phrase')
const JAPANESE = /[぀-ヿ㐀-䶿一-鿿]/

type Split = (text: string) => string[]
let split: Split | null = null
let loading: Promise<void> | null = null
const waiting = new Set<() => void>()
const cache = new Map<string, string[]>()
const CACHED = 2000

function load() {
  loading ??= import('budoux')
    .then(({ Parser, jaModel }) => {
      const parser = new Parser(jaModel)
      split = (text) => parser.parse(text)
      for (const done of waiting) done()
    })
    // Without it, titles break as the browser breaks them.
    .catch(() => {})
}

const subscribe = (done: () => void) => {
  waiting.add(done)
  return () => waiting.delete(done)
}

function phrasesOf(text: string, split: Split) {
  let phrases = cache.get(text)
  if (!phrases) {
    phrases = split(text)
    if (cache.size >= CACHED) cache.delete(cache.keys().next().value!)
    cache.set(text, phrases)
  }
  return phrases
}

/** A title that breaks between its phrases when it is Japanese; any other text as it is. */
export function Phrases({ text }: { text: string }) {
  const japanese = currentLocale() === 'ja' && JAPANESE.test(text)
  const needs = japanese && !native
  const ready = useSyncExternalStore(subscribe, () => split !== null)
  useEffect(() => {
    if (needs) load()
  }, [needs])
  if (!japanese) return text
  if (!needs || !ready || !split) return <span className="orq-phrases">{text}</span>
  return (
    <span className="orq-phrases">
      {phrasesOf(text, split).map((phrase, i) => (
        // The phrases of one text, always in the same order.
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {phrase}
        </Fragment>
      ))}
    </span>
  )
}
