import { describe, expect, it } from 'vitest'
import { dateText, dayName } from '../src/features/docs/editor/DateDialog'

// The «/» menu's «Date» writes a day as text, as the app's language writes it in full: the Markdown
// keeps it as it is, and anyone (or any agent) reads it.

describe('a date as text', () => {
  it('is the day in full, as each language writes it', () => {
    const day = new Date(2026, 10, 28, 15, 30)
    expect(Object.fromEntries(['es', 'en', 'fr', 'pt', 'it', 'de', 'nl', 'ja'].map((locale) => [locale, dateText(day, locale)]))).toEqual({
      es: '28 de noviembre de 2026',
      en: 'November 28, 2026',
      fr: '28 novembre 2026',
      pt: '28 de novembro de 2026',
      it: '28 novembre 2026',
      de: '28. November 2026',
      nl: '28 november 2026',
      ja: '2026年11月28日',
    })
  })

  it('is the day of the calendar, whatever the hour', () => {
    expect(dateText(new Date(2026, 0, 1, 0, 0), 'es')).toBe('1 de enero de 2026')
    expect(dateText(new Date(2026, 11, 31, 23, 59), 'es')).toBe('31 de diciembre de 2026')
  })
})

describe('today, tomorrow and yesterday', () => {
  it('are named as each language names them, with a capital', () => {
    expect([0, 1, -1].map((offset) => dayName(offset, 'es'))).toEqual(['Hoy', 'Mañana', 'Ayer'])
    expect([0, 1, -1].map((offset) => dayName(offset, 'en'))).toEqual(['Today', 'Tomorrow', 'Yesterday'])
    expect([0, 1, -1].map((offset) => dayName(offset, 'de'))).toEqual(['Heute', 'Morgen', 'Gestern'])
    expect([0, 1, -1].map((offset) => dayName(offset, 'ja'))).toEqual(['今日', '明日', '昨日'])
  })
})
