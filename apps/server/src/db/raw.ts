import type Sqlite from 'better-sqlite3'

export type SqlValue = string | number | null | Uint8Array

/**
 * Plain SQL on the copy's database, below Drizzle: what backups need to read every table as it
 * is, a row at a time, and to rebuild it. Synchronous on both runtimes, so a backup reads one
 * consistent snapshot and a restore applies all of it or none.
 */
export interface RawSql {
  /** The rows of a query as arrays of values in column order, read one at a time. */
  rows(query: string, ...params: SqlValue[]): IterableIterator<SqlValue[]>
  run(query: string, ...params: SqlValue[]): void
  /** Runs `work` in one transaction: everything it writes is kept, or nothing if it throws. */
  transaction<T>(work: () => T): T
}

/** better-sqlite3 (Node and Docker). */
export function nodeSql(sqlite: Sqlite.Database): RawSql {
  // A restore inserts many rows with the same statement: it is prepared once.
  const statements = new Map<string, Sqlite.Statement>()
  const prepared = (query: string) => {
    let statement = statements.get(query)
    if (!statement) {
      if (statements.size >= 64) statements.clear()
      statements.set(query, (statement = sqlite.prepare(query)))
    }
    return statement
  }
  return {
    rows: (query, ...params) => sqlite.prepare(query).raw(true).iterate(...params) as IterableIterator<SqlValue[]>,
    run: (query, ...params) => {
      prepared(query).run(...params)
    },
    transaction: (work) => sqlite.transaction(work)(),
  }
}
