import { type SQL, asc, eq } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { DbOrTx } from '../db/client'
import { evenlySpacedKeys, keyAtEnd, keyForIndex } from '../lib/positions'

type Ordered = SQLiteTable & { id: SQLiteColumn; position: SQLiteColumn }

/**
 * Computes the fractional key for placing an item at `index` among its
 * siblings (matching `scope`), rebalancing siblings if keys collide.
 * Synchronous, so it can run inside a transaction.
 */
export function positionAt(db: DbOrTx, target: Ordered, scope: SQL | undefined, index: number | undefined, excludeId?: string): string {
  const rows = db
    .select({ id: target.id, position: target.position })
    .from(target as SQLiteTable)
    .where(scope)
    .orderBy(asc(target.position), asc(target.id))
    .all() as Array<{ id: string; position: string }>
  const siblings = rows.filter((r) => r.id !== excludeId)
  const keys = siblings.map((r) => r.position)
  if (index === undefined || index >= siblings.length) {
    if (keys.length < 2 || keys.at(-2)! < keys.at(-1)!) return keyAtEnd(keys)
  } else {
    const key = keyForIndex(keys, index)
    if (key) return key
  }
  // Rebalance: rewrite every sibling key, leaving a slot at the target index.
  const slot = Math.max(0, Math.min(index ?? siblings.length, siblings.length))
  const fresh = evenlySpacedKeys(siblings.length + 1)
  let k = 0
  for (const sibling of siblings) {
    if (k === slot) k++
    db.update(target as SQLiteTable)
      .set({ position: fresh[k]! } as never)
      .where(eq(target.id, sibling.id))
      .run()
    k++
  }
  return fresh[slot]!
}
