import i18n from 'i18next'
import { onSessionEnded } from './api'

/**
 * Japanese has no spaces: a title breaks between phrases, never inside a word ("ござい|ます").
 * Chromium tells phrases apart itself (`word-break: auto-phrase`); elsewhere BudouX does, the same
 * model Chromium's is based on. This is the part of it the app starts with: it loads BudouX as soon
 * as the app is in Japanese in a browser that can't tell phrases apart, so the first page doesn't
 * wait for it. The titles themselves are split in components/Phrases.tsx.
 */
export const nativePhrases = typeof CSS !== 'undefined' && CSS.supports('word-break', 'auto-phrase')

export type Parse = (text: string) => string[]
let parse: Parse | null = null
let loading: Promise<void> | null = null
const waiting = new Set<() => void>()

/** BudouX's Japanese parser, once it is there. */
export const phraseParser = () => parse

/** Runs `done` when BudouX is there. */
export function onPhraseParser(done: () => void) {
  waiting.add(done)
  return () => {
    waiting.delete(done)
  }
}

export function loadPhrases() {
  if (nativePhrases || parse) return
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

/** From the start, and whenever the app turns to Japanese. */
export function followLanguageForPhrases() {
  if (i18n.resolvedLanguage === 'ja') loadPhrases()
  i18n.on('languageChanged', (language) => language === 'ja' && loadPhrases())
}

/** The phrases of the titles shown lately, so each is split once: the last 2000. */
const cache = new Map<string, string[]>()
const CACHED = 2000

export const cachedPhrases = (text: string) => cache.get(text)

export function rememberPhrases(text: string, phrases: string[]) {
  if (cache.size >= CACHED) cache.delete(cache.keys().next().value!)
  cache.set(text, phrases)
  return phrases
}

/** Forgets the titles shown: what the person signed in saw goes with their session. */
export function clearPhrases() {
  cache.clear()
}
onSessionEnded(clearPhrases)
