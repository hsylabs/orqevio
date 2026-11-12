import type { EncryptedExport } from './crypto'
import { type VaultItem, emptyItem } from './types'

/**
 * Moving credentials in and out of the vault, entirely in the browser.
 * Imports: the CSV of Chrome, Edge, Firefox and Safari, Bitwarden's CSV and
 * unencrypted JSON, and Orqevio's own encrypted export. Exports use Bitwarden's
 * JSON, which keeps every field and most password managers can import.
 */

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024

export type ImportProblem = 'empty' | 'unknown_format' | 'bitwarden_encrypted' | 'no_items'

export interface ImportedItems {
  kind: 'items'
  /** Where the file seems to come from, for the summary. */
  source: string
  items: VaultItem[]
  /** Entries that cannot be represented (cards, identities…). */
  unsupported: number
}

export type ImportOutcome = ImportedItems | { kind: 'encrypted'; file: EncryptedExport } | { kind: 'problem'; problem: ImportProblem }

/** RFC 4180 CSV: quoted fields may hold commas, quotes ("") and line breaks; a BOM is ignored. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let fieldStart = true
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
      continue
    }
    if (ch === '"' && fieldStart) {
      quoted = true
      fieldStart = false
    } else if (ch === ',') {
      row.push(field)
      field = ''
      fieldStart = true
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      fieldStart = true
    } else {
      field += ch
      fieldStart = false
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((value) => value.trim() !== ''))
}

// Column names seen in each exporter, compared without case.
const COLUMNS = {
  title: ['name', 'title'],
  url: ['url', 'login_uri', 'uri', 'website'],
  username: ['username', 'login_username'],
  password: ['password', 'login_password'],
  notes: ['note', 'notes'],
  totp: ['otpauth', 'login_totp', 'totp'],
  favorite: ['favorite'],
  type: ['type'],
  created: ['timecreated'],
  changed: ['timepasswordchanged'],
} as const

function csvSource(header: string[]) {
  if (header.includes('login_password')) return 'Bitwarden (CSV)'
  if (header.includes('otpauth')) return 'Safari'
  if (header.includes('httprealm') || header.includes('formactionorigin')) return 'Firefox'
  if (header.includes('name') && header.includes('url')) return 'Chrome o Edge'
  return 'CSV'
}

function host(url: string) {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Epoch milliseconds (Firefox) or ISO dates (Bitwarden) as ISO strings; null if unusable. */
function isoDate(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  const date = typeof value === 'number' || /^\d+$/.test(String(value)) ? new Date(Number(value)) : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function item(type: VaultItem['type'], fields: Partial<Record<'title' | 'url' | 'username' | 'password' | 'notes' | 'totp', unknown>>, extra: { favorite?: boolean; createdAt?: string | null; updatedAt?: string | null }): VaultItem | null {
  const text = (value: unknown) => (typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value))
  const next = emptyItem(type)
  next.url = text(fields.url).trim()
  next.username = text(fields.username)
  next.password = text(fields.password)
  next.notes = text(fields.notes)
  next.totp = type === 'login' ? text(fields.totp).trim() : ''
  next.title = text(fields.title).trim() || host(next.url) || next.username.trim() || (type === 'note' ? 'Nota' : 'Sin nombre')
  if (!next.url && !next.username && !next.password && !next.notes && !next.totp && !text(fields.title).trim()) return null
  next.favorite = extra.favorite ?? false
  if (extra.createdAt) next.createdAt = extra.createdAt
  next.updatedAt = extra.updatedAt ?? extra.createdAt ?? next.updatedAt
  return next
}

function fromCsv(text: string): ImportOutcome {
  const [rawHeader, ...rows] = parseCsv(text)
  if (!rawHeader) return { kind: 'problem', problem: 'empty' }
  const header = rawHeader.map((h) => h.trim().toLowerCase())
  const column = (names: readonly string[]) => header.findIndex((h) => names.includes(h))
  const at = Object.fromEntries(Object.entries(COLUMNS).map(([key, names]) => [key, column(names)])) as Record<keyof typeof COLUMNS, number>
  if (at.password === -1 && at.url === -1) return { kind: 'problem', problem: 'unknown_format' }
  const value = (row: string[], index: number) => (index >= 0 ? (row[index] ?? '') : '')
  const items: VaultItem[] = []
  for (const row of rows) {
    const type = value(row, at.type).trim().toLowerCase() === 'note' ? 'note' : 'login'
    const created = isoDate(value(row, at.created))
    const next = item(
      type,
      { title: value(row, at.title), url: value(row, at.url), username: value(row, at.username), password: value(row, at.password), notes: value(row, at.notes), totp: value(row, at.totp) },
      { favorite: ['1', 'true'].includes(value(row, at.favorite).trim().toLowerCase()), createdAt: created, updatedAt: isoDate(value(row, at.changed)) ?? created },
    )
    if (next) items.push(next)
  }
  return { kind: 'items', source: csvSource(header), items, unsupported: 0 }
}

interface BitwardenItem {
  type?: number
  name?: string
  notes?: string | null
  favorite?: boolean
  login?: { username?: string | null; password?: string | null; totp?: string | null; uris?: Array<{ uri?: string | null }> | null }
  creationDate?: string
  revisionDate?: string
}

function fromJson(text: string): ImportOutcome {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { kind: 'problem', problem: 'unknown_format' }
  }
  const json = data as { format?: string; encrypted?: boolean; passwordProtected?: boolean; items?: unknown }
  if (json.format === 'orqevio-vault-export' && typeof (json as EncryptedExport).data === 'string') return { kind: 'encrypted', file: json as EncryptedExport }
  if (json.encrypted === true || json.passwordProtected === true) return { kind: 'problem', problem: 'bitwarden_encrypted' }
  if (!Array.isArray(json.items)) return { kind: 'problem', problem: 'unknown_format' }
  return { kind: 'items', source: 'Bitwarden (JSON)', ...fromBitwardenItems(json.items as BitwardenItem[]) }
}

function fromBitwardenItems(entries: BitwardenItem[]) {
  const items: VaultItem[] = []
  let unsupported = 0
  for (const entry of entries) {
    if (entry.type !== 1 && entry.type !== 2) {
      unsupported++
      continue
    }
    const login = entry.type === 1 ? (entry.login ?? {}) : {}
    const next = item(
      entry.type === 1 ? 'login' : 'note',
      { title: entry.name, notes: entry.notes, username: login.username, password: login.password, totp: login.totp, url: login.uris?.find((u) => u.uri)?.uri },
      { favorite: entry.favorite === true, createdAt: isoDate(entry.creationDate), updatedAt: isoDate(entry.revisionDate) },
    )
    if (next) items.push(next)
  }
  return { items, unsupported }
}

/** Reads an export file; tells which format it is, or why it cannot be read. */
export function readImport(text: string): ImportOutcome {
  const trimmed = text.replace(/^﻿/, '').trim()
  if (!trimmed) return { kind: 'problem', problem: 'empty' }
  const outcome = trimmed.startsWith('{') ? fromJson(trimmed) : fromCsv(trimmed)
  return outcome.kind === 'items' && outcome.items.length === 0 && outcome.unsupported === 0 ? { kind: 'problem', problem: 'no_items' } : outcome
}

/** Decrypted Orqevio export → items. */
export function readDecryptedExport(plaintext: string): ImportedItems | null {
  const outcome = fromJson(plaintext)
  return outcome.kind === 'items' ? { ...outcome, source: 'Orqevio (cifrada)' } : null
}

/** Bitwarden's unencrypted JSON export format, with every field of every item. */
export function toBitwardenJson(items: VaultItem[]) {
  return {
    encrypted: false,
    folders: [],
    items: items.map((i) => ({
      id: i.id,
      organizationId: null,
      folderId: null,
      type: i.type === 'login' ? 1 : 2,
      reprompt: 0,
      name: i.title,
      notes: i.notes || null,
      favorite: i.favorite,
      ...(i.type === 'login'
        ? { login: { uris: i.url ? [{ match: null, uri: i.url }] : [], username: i.username || null, password: i.password || null, totp: i.totp || null } }
        : { secureNote: { type: 0 } }),
      collectionIds: null,
      creationDate: i.createdAt,
      revisionDate: i.updatedAt,
    })),
  }
}

const sameContent = (a: VaultItem, b: VaultItem) =>
  a.type === b.type && a.title === b.title && a.username === b.username && a.password === b.password && a.url === b.url && a.notes === b.notes && a.totp === b.totp

/** Splits imported items into new ones and exact copies of items already in the vault. */
export function withoutDuplicates(incoming: VaultItem[], existing: VaultItem[]) {
  const fresh: VaultItem[] = []
  let duplicates = 0
  for (const candidate of incoming) {
    if ([...existing, ...fresh].some((known) => sameContent(known, candidate))) duplicates++
    else fresh.push(candidate)
  }
  return { fresh, duplicates }
}
