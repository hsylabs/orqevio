import { t } from 'i18next'
import type { EncryptedExport } from './crypto'
import { ITEM_LIMITS, type VaultItem, emptyItem, tidyItem } from './types'

/**
 * Moving credentials in and out of the vault, entirely in the browser.
 * Imports: the CSV of Chrome, Edge, Firefox and Safari, Bitwarden's CSV and
 * unencrypted JSON, and Orqevio's own encrypted export. Exports use Bitwarden's
 * JSON, which keeps every field and most password managers can import.
 */

/**
 * Largest file an import reads. It fits the encrypted export of a full vault
 * (MAX_VAULT_ITEMS items with every field at the editor's limits, in
 * single-byte characters); an export above it is flagged when it is made.
 */
export const MAX_IMPORT_BYTES = 256 * 1024 * 1024

export type ImportProblem = 'empty' | 'unknown_format' | 'bitwarden_encrypted' | 'no_items' | 'unclosed_quote'

/** Where a file seems to come from. An identifier: the import summary names it in the app's language. */
export type ImportSource = 'Chrome o Edge' | 'Firefox' | 'Safari' | 'Bitwarden (CSV)' | 'Bitwarden (JSON)' | 'CSV' | 'Orqevio (cifrada)'

export interface ImportedItems {
  kind: 'items'
  /** Where the file seems to come from, for the summary. */
  source: ImportSource
  items: VaultItem[]
  /** Entries that cannot be represented (cards, identities, SSH keys). */
  unsupported: number
  /** Items whose extra data (custom fields, more addresses, older passwords) went into their notes. */
  extras: number
  /** Logins whose passkey cannot come along (the rest of each one does). */
  passkeys: number
  /** Items over the editor's limits, which the vault could not take: their titles. */
  tooLong: string[]
}

export type ImportOutcome = ImportedItems | { kind: 'encrypted'; file: EncryptedExport } | { kind: 'problem'; problem: ImportProblem; line?: number }

/** A quoted CSV field that never closes: everything after it would be read as one value. */
export class UnclosedQuoteError extends Error {
  constructor(readonly line: number) {
    super(`Unclosed quote opened on line ${line}`)
  }
}

/**
 * RFC 4180 CSV: quoted fields may hold commas, quotes ("") and line breaks; a BOM is ignored.
 * A quote left open throws UnclosedQuoteError, with the line it opened on.
 */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let fieldStart = true
  let line = 1
  let quoteLine = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (ch === '\n') line++
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
      quoteLine = line
      fieldStart = false
    } else if (ch === ',') {
      row.push(field)
      field = ''
      fieldStart = true
    } else if (ch === '\n' || ch === '\r') {
      // A CR ends a line too, alone or before the LF it then takes along.
      if (ch === '\r') {
        if (s[i + 1] === '\n') i++
        line++
      }
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
  if (quoted) throw new UnclosedQuoteError(quoteLine)
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((value) => value.trim() !== ''))
}

/**
 * The text of an import file. UTF-8 (with or without a BOM) and UTF-16 with a BOM are read as
 * they are; anything else is read as Windows-1252, the Latin-1 of older spreadsheets, and said so.
 */
export function decodeImport(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'utf-16' | 'windows-1252' } {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16' }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16' }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' }
  }
}

// Column names seen in each exporter, compared without case.
const COLUMNS = {
  title: ['name', 'title'],
  url: ['url', 'login_uri', 'uri', 'website'],
  username: ['username', 'login_username'],
  password: ['password', 'login_password'],
  notes: ['note', 'notes'],
  fields: ['fields'],
  totp: ['otpauth', 'login_totp', 'totp'],
  favorite: ['favorite'],
  type: ['type'],
  created: ['timecreated'],
  changed: ['timepasswordchanged'],
} as const

function csvSource(header: string[]): ImportSource {
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

const text = (value: unknown) => (typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value))

/** What an exporter has and the vault has no field for, kept in the item's notes under headings. */
interface Extras {
  /** Custom fields, one per line ("PIN: 1234"). */
  fields?: string[]
  /** Addresses after the first one. */
  uris?: string[]
  /** Older passwords, newest first. */
  history?: string[]
}

function withExtras(notes: string, extras: Extras) {
  const sections = (
    [
      ['fields', extras.fields],
      ['uris', extras.uris],
      ['history', extras.history],
    ] as const
  )
    .filter(([, lines]) => lines?.length)
    .map(([kind, lines]) => `${t(`vault:import.extra.${kind}`)}\n${lines!.join('\n')}`)
  return [notes.trimEnd(), ...sections].filter(Boolean).join('\n\n')
}

/** An imported entry as a vault item: null if it holds nothing at all, 'too_long' if over the editor's limits. */
function item(
  type: VaultItem['type'],
  fields: Partial<Record<'title' | 'url' | 'username' | 'password' | 'notes' | 'totp', unknown>>,
  extra: { favorite?: boolean; createdAt?: string | null; updatedAt?: string | null; extras?: Extras },
): VaultItem | 'too_long' | null {
  const next = emptyItem(type)
  next.url = text(fields.url)
  next.username = text(fields.username)
  next.password = text(fields.password)
  next.notes = extra.extras ? withExtras(text(fields.notes), extra.extras) : text(fields.notes)
  next.totp = type === 'login' ? text(fields.totp) : ''
  next.title = text(fields.title)
  // Spaces around the title, the address and the code go, as when an item is saved in the vault.
  const tidy = tidyItem(next)
  if (!tidy.url && !tidy.username && !tidy.password && !tidy.notes && !tidy.totp && !tidy.title) return null
  tidy.title ||= host(tidy.url) || tidy.username.trim() || (type === 'note' ? t('vault:import.untitledNote') : t('vault:import.untitledLogin'))
  if ((Object.keys(ITEM_LIMITS) as Array<keyof typeof ITEM_LIMITS>).some((field) => tidy[field].length > ITEM_LIMITS[field])) return 'too_long'
  tidy.favorite = extra.favorite ?? false
  if (extra.createdAt) tidy.createdAt = extra.createdAt
  tidy.updatedAt = extra.updatedAt ?? extra.createdAt ?? tidy.updatedAt
  return tidy
}

/** Sorts what item() gave into the items, the ones too long and those with extras in their notes. */
function collector() {
  const items: VaultItem[] = []
  const tooLong: string[] = []
  let extras = 0
  return {
    add(next: VaultItem | 'too_long' | null, title: unknown, hadExtras: boolean) {
      if (next === 'too_long') tooLong.push(text(title).trim() || t('vault:import.untitledLogin'))
      else if (next) {
        items.push(next)
        if (hadExtras) extras++
      }
    },
    result: () => ({ items, tooLong, extras }),
  }
}

function fromCsv(text: string): ImportOutcome {
  let parsed: string[][]
  try {
    parsed = parseCsv(text)
  } catch (error) {
    if (error instanceof UnclosedQuoteError) return { kind: 'problem', problem: 'unclosed_quote', line: error.line }
    throw error
  }
  const [rawHeader, ...rows] = parsed
  if (!rawHeader) return { kind: 'problem', problem: 'empty' }
  const header = rawHeader.map((h) => h.trim().toLowerCase())
  const column = (names: readonly string[]) => header.findIndex((h) => names.includes(h))
  const at = Object.fromEntries(Object.entries(COLUMNS).map(([key, names]) => [key, column(names)])) as Record<keyof typeof COLUMNS, number>
  if (at.password === -1 && at.url === -1) return { kind: 'problem', problem: 'unknown_format' }
  const value = (row: string[], index: number) => (index >= 0 ? (row[index] ?? '') : '')
  const source = csvSource(header)
  const found = collector()
  for (const row of rows) {
    const type = value(row, at.type).trim().toLowerCase() === 'note' ? 'note' : 'login'
    const created = isoDate(value(row, at.created))
    // Bitwarden puts every address of a login in one column, separated by commas, and its
    // custom fields in another, one "name: value" per line.
    const uris = source === 'Bitwarden (CSV)' ? value(row, at.url).split(',').map((uri) => uri.trim()).filter(Boolean) : [value(row, at.url)]
    const extras: Extras = { fields: value(row, at.fields).split(/\r?\n/).filter((line) => line.trim()), uris: uris.slice(1) }
    const hadExtras = Boolean(extras.fields!.length || extras.uris!.length)
    found.add(
      item(
        type,
        { title: value(row, at.title), url: uris[0] ?? '', username: value(row, at.username), password: value(row, at.password), notes: value(row, at.notes), totp: value(row, at.totp) },
        { favorite: ['1', 'true'].includes(value(row, at.favorite).trim().toLowerCase()), createdAt: created, updatedAt: isoDate(value(row, at.changed)) ?? created, extras },
      ),
      value(row, at.title),
      hadExtras,
    )
  }
  return { kind: 'items', source, ...found.result(), unsupported: 0, passkeys: 0 }
}

interface BitwardenItem {
  type?: number
  name?: string
  notes?: string | null
  favorite?: boolean
  login?: { username?: string | null; password?: string | null; totp?: string | null; uris?: Array<{ uri?: string | null }> | null; fido2Credentials?: unknown[] | null }
  /** Custom fields. Type 0 text, 1 hidden, 2 boolean, 3 linked to another field (no value of its own). */
  fields?: Array<{ name?: string | null; value?: string | null; type?: number }> | null
  passwordHistory?: Array<{ password?: string | null; lastUsedDate?: string | null }> | null
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
  const found = collector()
  let unsupported = 0
  let passkeys = 0
  for (const entry of entries) {
    if (entry.type !== 1 && entry.type !== 2) {
      unsupported++
      continue
    }
    const login = entry.type === 1 ? (entry.login ?? {}) : {}
    const uris = (login.uris ?? []).map((u) => text(u.uri).trim()).filter(Boolean)
    const extras: Extras = {
      fields: (entry.fields ?? [])
        .filter((field) => field.type !== 3 && (text(field.name).trim() || text(field.value)))
        .map((field) => (text(field.name).trim() ? `${text(field.name).trim()}: ${text(field.value)}` : text(field.value))),
      uris: uris.slice(1),
      history: (entry.passwordHistory ?? [])
        .filter((old) => text(old.password))
        .map((old) => {
          const when = isoDate(old.lastUsedDate)
          return when ? `${text(old.password)} (${when.slice(0, 10)})` : text(old.password)
        }),
    }
    const hadExtras = Boolean(extras.fields!.length || extras.uris!.length || extras.history!.length)
    if (login.fido2Credentials?.length) passkeys++
    found.add(
      item(
        entry.type === 1 ? 'login' : 'note',
        { title: entry.name, notes: entry.notes, username: login.username, password: login.password, totp: login.totp, url: uris[0] },
        { favorite: entry.favorite === true, createdAt: isoDate(entry.creationDate), updatedAt: isoDate(entry.revisionDate), extras },
      ),
      entry.name,
      hadExtras,
    )
  }
  return { ...found.result(), unsupported, passkeys }
}

/** Reads an export file; tells which format it is, or why it cannot be read. */
export function readImport(text: string): ImportOutcome {
  // Trimming is only for detection: a CSV's last field may end in spaces that belong to a password.
  const body = text.replace(/^﻿/, '')
  const start = body.trimStart()
  if (!start) return { kind: 'problem', problem: 'empty' }
  const outcome = start.startsWith('{') ? fromJson(start) : fromCsv(body)
  return outcome.kind === 'items' && outcome.items.length === 0 && outcome.unsupported === 0 && outcome.tooLong.length === 0 ? { kind: 'problem', problem: 'no_items' } : outcome
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

/** The same item, compared as the vault saves it: without spaces around its title, address and code. */
function sameContent(first: VaultItem, second: VaultItem) {
  const a = tidyItem(first)
  const b = tidyItem(second)
  return a.type === b.type && a.title === b.title && a.username === b.username && a.password === b.password && a.url === b.url && a.notes === b.notes && a.totp === b.totp
}

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
