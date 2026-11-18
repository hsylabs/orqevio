import { type Table, getTableColumns } from 'drizzle-orm'

/** The parameters SQLite takes in one query inside a Cloudflare Durable Object. */
export const MAX_PARAMETERS = 100

/**
 * Rows to insert in groups small enough for one INSERT each. A row binds at most one parameter per
 * column of its table, so a group never passes MAX_PARAMETERS: a page that mentions many cards, or
 * a board created with all its columns, would otherwise fail on Cloudflare while working on Node.
 */
export function inGroups<T>(table: Table, rows: readonly T[]): T[][] {
  const size = Math.max(1, Math.floor(MAX_PARAMETERS / Object.keys(getTableColumns(table)).length))
  const groups: T[][] = []
  for (let i = 0; i < rows.length; i += size) groups.push(rows.slice(i, i + size))
  return groups
}
