import type { Locale } from '@orqevio/shared'
import { type DayPickerLocale, de, enUS, es, fr, it, ja, nl, ptBR } from 'react-day-picker/locale'

/**
 * A calendar in the language the app is showing: its month and weekday names, and what a screen
 * reader says of its days and buttons.
 */
export const DATE_LOCALES: Record<Locale, DayPickerLocale> = { en: enUS, es, fr, pt: ptBR, it, de, nl, ja }
