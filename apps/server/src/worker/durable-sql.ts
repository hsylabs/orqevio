import type { RawSql, SqlValue } from '../db/raw'

/** Plain SQL on a Durable Object's SQLite storage (see RawSql). */
export function durableSql(storage: DurableObjectStorage): RawSql {
  const toValue = (value: unknown): SqlValue => (value instanceof ArrayBuffer ? new Uint8Array(value) : (value as SqlValue))
  return {
    rows: function* (query, ...params) {
      for (const row of storage.sql.exec(query, ...params).raw()) yield row.map(toValue)
    },
    run: (query, ...params) => {
      storage.sql.exec(query, ...params).toArray()
    },
    transaction: (work) => storage.transactionSync(work),
  }
}
