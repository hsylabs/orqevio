/** One line of a line-by-line comparison: kept, added or removed. */
export interface DiffLine {
  type: 'same' | 'added' | 'removed'
  text: string
}

export const splitLines = (text: string) => (text === '' ? [] : text.split('\n'))

/**
 * Lines added and removed between two texts, counted as multisets: cheap enough to run on
 * every save, and the same as the line diff for most edits.
 */
export function lineStats(before: string, after: string) {
  const counts = new Map<string, number>()
  for (const line of splitLines(before)) counts.set(line, (counts.get(line) ?? 0) + 1)
  let added = 0
  for (const line of splitLines(after)) {
    const left = counts.get(line) ?? 0
    if (left > 0) counts.set(line, left - 1)
    else added++
  }
  let removed = 0
  for (const left of counts.values()) removed += left
  return { added, removed }
}

/** Beyond this many differing lines, the middle of the texts shows as replaced whole. */
const MAX_EDITS = 1000

/**
 * The lines of `after` compared with those of `before`, like `git diff`: the shortest
 * list of removed and added lines (Myers' algorithm), with what they share around them.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before)
  const b = splitLines(after)
  // The common start and end are kept as they are; only the middle is compared.
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  const head = a.slice(0, start).map((text): DiffLine => ({ type: 'same', text }))
  const tail = a.slice(a.length - end).map((text): DiffLine => ({ type: 'same', text }))
  const middle = myers(a.slice(start, a.length - end), b.slice(start, b.length - end))
  return [...head, ...middle, ...tail]
}

function myers(a: string[], b: string[]): DiffLine[] {
  const n = a.length
  const m = b.length
  const replaced = (): DiffLine[] => [...a.map((text): DiffLine => ({ type: 'removed', text })), ...b.map((text): DiffLine => ({ type: 'added', text }))]
  if (n === 0 || m === 0) return replaced()
  const max = Math.min(n + m, MAX_EDITS)
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let found = -1
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        found = d
        break
      }
    }
  }
  if (found < 0) return replaced()
  // Walk back through the saved frontiers to recover the edits, then read them in order.
  const out: DiffLine[] = []
  let x = n
  let y = m
  for (let d = found; d > 0; d--) {
    const prev = trace[d]!
    const k = x - y
    const down = k === -d || (k !== d && prev[offset + k - 1]! < prev[offset + k + 1]!)
    const prevK = down ? k + 1 : k - 1
    const prevX = prev[offset + prevK]!
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      y--
      out.push({ type: 'same', text: a[--x]! })
    }
    if (down) out.push({ type: 'added', text: b[--y]! })
    else out.push({ type: 'removed', text: a[--x]! })
  }
  while (x > 0 && y > 0) {
    y--
    out.push({ type: 'same', text: a[--x]! })
  }
  return out.reverse()
}
