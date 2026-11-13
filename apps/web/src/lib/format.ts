import { differenceInCalendarDays } from 'date-fns'
import { t } from 'i18next'
import { currentLocale } from '../i18n'

/**
 * Dates, numbers and lists in the language the app is showing. Components that
 * render these call useTranslation(), so they render again when it changes.
 */

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 86_400],
  ['month', 30 * 86_400],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
]

/** "3 minutes ago", "yesterday"… */
export function relativeTime(iso: string) {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000
  if (Math.abs(seconds) < 45) return t('time.justNow')
  const format = new Intl.RelativeTimeFormat(currentLocale(), { numeric: 'auto' })
  const [unit, size] = UNITS.find(([, size]) => Math.abs(seconds) >= size) ?? ['second', 1]
  return format.format(Math.round(seconds / size), unit)
}

/** "Nov 13", or "Nov 13, 2025" outside this year. */
export function shortDate(iso: string) {
  const date = new Date(iso)
  const thisYear = date.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', ...(thisYear ? {} : { year: 'numeric' }) }).format(date)
}

/** "Friday, November 13" */
export function longDate(date = new Date()) {
  return new Intl.DateTimeFormat(currentLocale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(date)
}

export type DueState = 'overdue' | 'today' | 'soon' | 'later'

/** Due dates are calendar days (stored at 12:00 UTC); compare in the local calendar. */
export function dueState(iso: string): DueState {
  const days = differenceInCalendarDays(dueToLocalDate(iso), new Date())
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  if (days <= 2) return 'soon'
  return 'later'
}

export function dueLabel(iso: string) {
  const days = differenceInCalendarDays(dueToLocalDate(iso), new Date())
  if (days === 0) return t('due.today')
  if (days === 1) return t('due.tomorrow')
  if (days === -1) return t('due.yesterday')
  return shortDate(dueToLocalDate(iso).toISOString())
}

/** Converts the stored UTC noon into a local date with the same calendar day. */
export function dueToLocalDate(iso: string) {
  const d = new Date(iso)
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12)
}

export function localDateToDue(date: Date) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12)).toISOString()
}

export function greeting(date = new Date()) {
  const h = date.getHours()
  if (h < 6) return t('greeting.night')
  if (h < 14) return t('greeting.morning')
  if (h < 21) return t('greeting.afternoon')
  return t('greeting.evening')
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() || '·'
}

/** "12 B", "340 kB", "1.5 MB", with the units and separators of the language. */
export function bytes(n: number) {
  const [unit, value, digits] = n < 1024 ? ['byte', n, 0] : n < 1024 * 1024 ? ['kilobyte', n / 1024, 0] : ['megabyte', n / 1024 / 1024, 1]
  return new Intl.NumberFormat(currentLocale(), { style: 'unit', unit, unitDisplay: unit === 'byte' ? 'narrow' : 'short', maximumFractionDigits: digits as number }).format(
    value as number,
  )
}

export const formatNumber = (n: number) => new Intl.NumberFormat(currentLocale()).format(n)

/** "a, b and c" */
export const formatList = (items: string[]) => new Intl.ListFormat(currentLocale(), { type: 'conjunction' }).format(items)

/** @deprecated Being replaced by plural keys in the catalogs. */
export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}
