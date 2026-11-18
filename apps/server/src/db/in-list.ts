import { type SQL, type SQLWrapper, sql } from 'drizzle-orm'

/**
 * `column IN (...values)` with the values as one JSON parameter. SQLite in a Durable Object takes
 * at most 100 parameters a query, so a list as long as a board's cards can't go one by one.
 */
export const inList = (column: SQLWrapper, values: readonly string[]): SQL => sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(values)}))`
