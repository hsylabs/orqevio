import type { Locale } from '@orqevio/shared'
import { type Locale as DateLocale } from 'date-fns'
import { de, enUS, es, fr, it, ja, nl, ptBR } from 'date-fns/locale'

/** A calendar's month and weekday names, in the language the app is showing. */
export const DATE_LOCALES: Record<Locale, DateLocale> = { en: enUS, es, fr, pt: ptBR, it, de, nl, ja }
