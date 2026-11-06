import { differenceInCalendarDays, format, formatDistanceToNowStrict, isThisYear } from 'date-fns'
import { es } from 'date-fns/locale'

export function relativeTime(iso: string) {
  const date = new Date(iso)
  const diff = Date.now() - date.getTime()
  if (diff < 45_000) return 'ahora mismo'
  return `hace ${formatDistanceToNowStrict(date, { locale: es })}`
}

export function shortDate(iso: string) {
  const date = new Date(iso)
  return format(date, isThisYear(date) ? "d 'de' MMM" : "d MMM yyyy", { locale: es })
}

export function longDate(date = new Date()) {
  return format(date, "EEEE, d 'de' MMMM", { locale: es })
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
  if (days === 0) return 'Hoy'
  if (days === 1) return 'Mañana'
  if (days === -1) return 'Ayer'
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
  if (h < 6) return 'Buenas noches'
  if (h < 14) return 'Buenos días'
  if (h < 21) return 'Buenas tardes'
  return 'Buenas noches'
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() || '·'
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}
