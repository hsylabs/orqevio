import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'

/**
 * Returns a key that sorts at `index` within `keys` (already sorted, and not
 * containing the item being moved). Returns null when neighbours collide
 * (possible after concurrent inserts) so the caller can rebalance.
 */
export function keyForIndex(keys: readonly string[], index: number): string | null {
  const i = Math.max(0, Math.min(index, keys.length))
  const before = keys[i - 1] ?? null
  const after = keys[i] ?? null
  if (before !== null && after !== null && before >= after) return null
  return generateKeyBetween(before, after)
}

export const keyAtEnd = (keys: readonly string[]) => generateKeyBetween(keys.at(-1) ?? null, null)

export const evenlySpacedKeys = (count: number) => generateNKeysBetween(null, null, count)
