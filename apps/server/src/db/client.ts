import Sqlite from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import * as schema from './schema'

/**
 * Services only rely on a synchronous SQLite database, so the same code runs on
 * a local file (better-sqlite3) and inside a Cloudflare Durable Object.
 * Transactions are synchronous callbacks: keep I/O (files, network) outside them.
 */
export type Database = BaseSQLiteDatabase<'sync', unknown, typeof schema>
/** Transaction handle type, usable wherever `db` is. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]
export type DbOrTx = Database | Tx

export function openDatabase(file: string) {
  const sqlite = new Sqlite(file)
  // WAL lets reads continue while a write commits; foreign keys are off by default in SQLite.
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  const db = drizzle(sqlite, { schema })
  return { db: db as unknown as Database, sqlite, close: () => sqlite.close() }
}

export function runMigrations(db: Database, migrationsFolder: string) {
  migrate(db as unknown as BetterSQLite3Database<typeof schema>, { migrationsFolder })
}
