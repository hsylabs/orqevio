import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import * as schema from './schema'

export type Database = ReturnType<typeof createDatabase>['db']

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: Number(process.env.DATABASE_POOL_SIZE ?? 10) })
  const db = drizzle(pool, { schema, casing: undefined })
  return { db, pool }
}

export async function runMigrations(db: Database, migrationsFolder: string) {
  await migrate(db, { migrationsFolder })
}

/** Transaction handle type, usable wherever `db` is. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]
export type DbOrTx = Database | Tx
