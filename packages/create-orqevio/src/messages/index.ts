import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { it } from './it'
import { ja } from './ja'
import { nl } from './nl'
import { pt } from './pt'
import type { Messages } from './types'

export type { Action, Messages } from './types'

/** The languages of Orqevio (LOCALES in @orqevio/shared), English first. */
export const LANGUAGES = ['en', 'es', 'fr', 'pt', 'it', 'de', 'nl', 'ja'] as const
export type Language = (typeof LANGUAGES)[number]

export const CATALOGS: Record<Language, Messages> = { en, es, fr, pt, it, de, nl, ja }

export const isLanguage = (value: string): value is Language => (LANGUAGES as readonly string[]).includes(value)

/**
 * The language of the terminal: LANGUAGE (a list), LC_ALL, LC_MESSAGES or LANG, as
 * gettext reads them, then the system locale; English when none is available.
 */
export function detectLanguage(env: Record<string, string | undefined> = process.env, systemLocale = Intl.DateTimeFormat().resolvedOptions().locale): Language {
  const candidates = [...(env.LANGUAGE ?? '').split(':'), env.LC_ALL, env.LC_MESSAGES, env.LANG, systemLocale]
  for (const candidate of candidates) {
    const base = candidate?.trim().toLowerCase().split(/[-_.@]/)[0]
    if (base && isLanguage(base)) return base
  }
  return 'en'
}
