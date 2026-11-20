import { Gunzip, Gzip, strToU8 } from 'fflate'
import type { RawSql, SqlValue } from '../db/raw'

/**
 * The data of a backup: every table of the copy's SQLite database, its schema and its rows,
 * as gzipped JSON lines. The same file comes out of Node and of a Durable Object, and goes
 * back into either.
 *
 *   {"format":"orqevio-backup","version":1,…,"schema":[…]}   the header, with the schema
 *   {"table":"cards","columns":["rowid","id",…]}               then each table…
 *   ["…","…",…]                                                …and its rows
 *   {"end":true,"rows":1234}                                   the end: a file without it is cut short
 *
 * Rows keep their rowid (the history orders by it), and full-text indexes keep their rows, so a
 * restored copy finds the same things. Reading and writing are synchronous: a backup is one
 * snapshot of the database, and a restore rebuilds it in one transaction.
 */

export const DUMP_FORMAT = 'orqevio-backup'
export const DUMP_VERSION = 1

export interface SchemaObject {
  type: 'table' | 'index' | 'trigger' | 'view'
  name: string
  sql: string
}

export interface DumpHeader {
  format: typeof DUMP_FORMAT
  version: typeof DUMP_VERSION
  /** The version of Orqevio that made it. */
  app: string
  createdAt: string
  /** When the newest migration it has was written (`created_at` in __drizzle_migrations), 0 if none. */
  migration: number
  schema: SchemaObject[]
}

/** The tables SQLite makes for each full-text (FTS5) table: they come back with it. */
const FTS_SHADOWS = ['_data', '_idx', '_content', '_docsize', '_config']
const VIRTUAL = /^\s*CREATE\s+VIRTUAL\s+TABLE/i
const MIGRATIONS_TABLE = '__drizzle_migrations'

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`

/** What belongs to Orqevio in the database: not SQLite's own tables, nor the Durable Object's (`_cf_`). */
function schemaObjects(sql: RawSql): SchemaObject[] {
  const objects: SchemaObject[] = []
  for (const [type, name, objectSql] of sql.rows(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND substr(name, 1, 7) <> 'sqlite_' AND substr(name, 1, 4) <> '_cf_' ORDER BY rowid",
  )) {
    objects.push({ type: type as SchemaObject['type'], name: String(name), sql: String(objectSql) })
  }
  const virtual = objects.filter((o) => o.type === 'table' && VIRTUAL.test(o.sql)).map((o) => o.name)
  return objects.filter((o) => !(o.type === 'table' && virtual.some((v) => FTS_SHADOWS.some((suffix) => o.name === `${v}${suffix}`))))
}

const isVirtual = (object: SchemaObject) => object.type === 'table' && VIRTUAL.test(object.sql)

/** The columns to copy: all of them, plus the rowid unless a column is the rowid already. */
function tableColumns(sql: RawSql, table: SchemaObject) {
  const columns: string[] = []
  let integerKeys = 0
  let keys = 0
  for (const [name, type, pk] of sql.rows('SELECT name, type, pk FROM pragma_table_info(?)', table.name)) {
    columns.push(String(name))
    if (Number(pk) > 0) {
      keys++
      if (String(type).toUpperCase() === 'INTEGER') integerKeys++
    }
  }
  const rowidAlias = keys === 1 && integerKeys === 1
  return rowidAlias ? columns : ['rowid', ...columns]
}

function lastMigration(sql: RawSql, objects: SchemaObject[]) {
  if (!objects.some((o) => o.type === 'table' && o.name === MIGRATIONS_TABLE)) return 0
  const [row] = [...sql.rows(`SELECT max(CAST(created_at AS INTEGER)) FROM ${quote(MIGRATIONS_TABLE)}`)]
  return Number(row?.[0] ?? 0)
}

/** When the newest migration of this database was written (see DumpHeader.migration). */
export function currentMigration(sql: RawSql) {
  return lastMigration(sql, schemaObjects(sql))
}

const toBase64 = (bytes: Uint8Array) => {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}
const encode = (value: SqlValue) => (value instanceof Uint8Array ? { $b: toBase64(value) } : value)
const decode = (value: unknown): SqlValue =>
  value && typeof value === 'object' && '$b' in value ? Uint8Array.from(atob(String((value as { $b: string }).$b)), (c) => c.charCodeAt(0)) : (value as SqlValue)

/**
 * Deletes every row, what references a table before the table itself, so that no cascade has
 * anything left to do and dropping the tables afterwards checks nothing. A table that references
 * itself (pages in their tree) goes from its leaves up: on Cloudflare a long chain of cascades fails.
 */
function emptyTables(sql: RawSql, tables: string[]) {
  const order: string[] = []
  const references = new Map<string, Array<{ parent: string; from: string; to: string }>>()
  for (const table of tables) {
    const keys: Array<{ parent: string; from: string; to: string }> = []
    for (const [parent, from, to] of sql.rows('SELECT "table", "from", "to" FROM pragma_foreign_key_list(?)', table)) {
      keys.push({ parent: String(parent), from: String(from), to: String(to ?? 'rowid') })
    }
    references.set(table, keys)
  }
  const done = new Set<string>()
  const count = (table: string) => Number([...sql.rows(`SELECT count(*) FROM ${quote(table)}`)][0]?.[0] ?? 0)
  const empty = (table: string) => {
    for (const { from, to } of references.get(table)!.filter((k) => k.parent === table)) {
      // Leaves first: rows no other row of the table points to.
      let left = count(table)
      while (left > 0) {
        sql.run(`DELETE FROM ${quote(table)} WHERE ${quote(to)} NOT IN (SELECT ${quote(from)} FROM ${quote(table)} WHERE ${quote(from)} IS NOT NULL)`)
        const now = count(table)
        if (now === left) break
        left = now
      }
    }
    sql.run(`DELETE FROM ${quote(table)}`)
    done.add(table)
    order.push(table)
  }
  // Children before parents; whatever is left (a loop between tables) goes last, foreign keys being deferred.
  let progress = true
  while (progress) {
    progress = false
    for (const table of tables) {
      if (done.has(table)) continue
      const children = tables.filter((t) => t !== table && !done.has(t) && references.get(t)!.some((k) => k.parent === table))
      if (children.length) continue
      empty(table)
      progress = true
    }
  }
  for (const table of tables) if (!done.has(table)) empty(table)
  // The order to drop them in too: SQLite won't even prepare dropping a table whose parent is gone.
  return order
}

/** Writes the whole database as a backup's data. Synchronous: one consistent snapshot. */
export function writeDump(sql: RawSql, app: string, createdAt: Date) {
  const chunks: Uint8Array[] = []
  let bytes = 0
  const gzip = new Gzip({ level: 6 }, (chunk) => {
    chunks.push(chunk)
    bytes += chunk.length
  })
  let pending = ''
  const line = (value: unknown) => {
    pending += `${JSON.stringify(value)}\n`
    if (pending.length >= 64 * 1024) {
      gzip.push(strToU8(pending))
      pending = ''
    }
  }

  const schema = schemaObjects(sql)
  line({ format: DUMP_FORMAT, version: DUMP_VERSION, app, createdAt: createdAt.toISOString(), migration: lastMigration(sql, schema), schema } satisfies DumpHeader)
  const counts: Record<string, number> = {}
  let rows = 0
  for (const table of schema.filter((o) => o.type === 'table')) {
    const columns = tableColumns(sql, table)
    line({ table: table.name, columns })
    let count = 0
    for (const row of sql.rows(`SELECT ${columns.map(quote).join(', ')} FROM ${quote(table.name)}`)) {
      line(row.map(encode))
      count++
    }
    counts[table.name] = count
    rows += count
  }
  line({ end: true, rows })
  gzip.push(strToU8(pending), true)

  const data = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.length
  }
  return { data, counts, rows }
}

/** The JSON lines of a backup's data, decompressed a piece at a time. */
function* readLines(data: Uint8Array): Generator<unknown> {
  const decoder = new TextDecoder()
  let text = ''
  let ready: string[] = []
  const gunzip = new Gunzip((chunk) => {
    text += decoder.decode(chunk, { stream: true })
    const lines = text.split('\n')
    text = lines.pop()!
    ready.push(...lines)
  })
  const STEP = 256 * 1024
  for (let offset = 0; offset < data.length; offset += STEP) {
    gunzip.push(data.subarray(offset, offset + STEP), offset + STEP >= data.length)
    const batch = ready
    ready = []
    for (const next of batch) if (next) yield JSON.parse(next)
  }
  text += decoder.decode()
  if (text) yield JSON.parse(text)
}

/** Reads only the header of a backup's data, without going through the rows. */
export function readHeader(data: Uint8Array): DumpHeader {
  const first = readLines(data).next()
  const header = first.done ? null : (first.value as DumpHeader)
  if (!header || header.format !== DUMP_FORMAT) throw new DumpError('not_a_backup')
  if (header.version !== DUMP_VERSION) throw new DumpError('newer_format')
  return header
}

/**
 * The name of each attachment a backup's data lists, by storage key, among its attachments and in
 * its trash: for backups whose manifest doesn't say them (made before 1.3).
 */
export function fileNames(data: Uint8Array): Map<string, string> {
  const names = new Map<string, string>()
  let reading: { table: string; key: number; name: number; data: number } | null = null
  for (const line of readLines(data)) {
    if (Array.isArray(line)) {
      const key = reading ? line[reading.key] : undefined
      if (!reading || typeof key !== 'string') continue
      if (reading.table === 'attachments') {
        const name = line[reading.name]
        if (typeof name === 'string') names.set(key, name)
      } else {
        try {
          const row = JSON.parse(String(line[reading.data])) as { filename?: unknown }
          if (typeof row.filename === 'string') names.set(key, row.filename)
        } catch {
          // Not a row of a file.
        }
      }
    } else if (line && typeof line === 'object' && 'table' in line) {
      const { table, columns } = line as { table: string; columns: string[] }
      reading = (table === 'attachments' || table === 'trash_rows') && columns.includes('storage_key') ? { table, key: columns.indexOf('storage_key'), name: columns.indexOf('filename'), data: columns.indexOf('data') } : null
    } else if (line && typeof line === 'object' && 'end' in line) break
  }
  return names
}

export class DumpError extends Error {
  constructor(readonly code: 'not_a_backup' | 'newer_format' | 'newer_version' | 'cut_short') {
    super(`This backup can't be restored: ${code}`)
  }
}

/**
 * Replaces the whole database with a backup's data, in one transaction: if anything fails, it is
 * left as it was. Foreign keys are checked once everything is in. `before` runs inside the same
 * transaction once the rows are in, to keep what must outlive the restore. Migrations newer than
 * the backup are left to run afterwards.
 */
export function restoreDump(sql: RawSql, data: Uint8Array, { migration, before }: { migration: number; before?: () => void }) {
  const header = readHeader(data)
  if (header.migration > migration) throw new DumpError('newer_version')
  return sql.transaction(() => {
    sql.run('PRAGMA defer_foreign_keys = ON')
    // Away with what is there now: triggers first, then every row, then views, full-text tables (with their own tables) and the rest.
    const current = schemaObjects(sql)
    for (const object of current.filter((o) => o.type === 'trigger')) sql.run(`DROP TRIGGER IF EXISTS ${quote(object.name)}`)
    const order = emptyTables(sql, current.filter((o) => o.type === 'table' && !isVirtual(o)).map((o) => o.name))
    for (const object of current.filter((o) => o.type === 'view')) sql.run(`DROP VIEW IF EXISTS ${quote(object.name)}`)
    for (const object of current.filter(isVirtual)) sql.run(`DROP TABLE IF EXISTS ${quote(object.name)}`)
    for (const table of order) sql.run(`DROP TABLE IF EXISTS ${quote(table)}`)

    // The backup's tables, rows, then indexes and triggers: triggers mustn't fire for rows that are restored as they were.
    for (const object of header.schema.filter((o) => o.type === 'table')) sql.run(object.sql)
    const lines = readLines(data)
    lines.next()
    let insert: { sql: string; width: number } | null = null
    let rows = 0
    let ended = false
    for (const line of lines) {
      if (Array.isArray(line)) {
        if (!insert || line.length !== insert.width) throw new DumpError('cut_short')
        sql.run(insert.sql, ...line.map(decode))
        rows++
      } else if (line && typeof line === 'object' && 'table' in line) {
        const { table, columns } = line as { table: string; columns: string[] }
        insert = { sql: `INSERT INTO ${quote(table)} (${columns.map(quote).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, width: columns.length }
      } else if (line && typeof line === 'object' && 'end' in line) {
        if ((line as unknown as { rows: number }).rows !== rows) throw new DumpError('cut_short')
        ended = true
        break
      }
    }
    if (!ended) throw new DumpError('cut_short')
    for (const object of header.schema.filter((o) => o.type === 'index' || o.type === 'view')) sql.run(object.sql)
    for (const object of header.schema.filter((o) => o.type === 'trigger')) sql.run(object.sql)
    before?.()
    return { header, rows }
  })
}
