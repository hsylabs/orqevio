/** Bytes `start` to `end` of a file, both included, as HTTP counts them. */
export interface ByteRange {
  start: number
  end: number
}

/**
 * The bytes of a file of `size` that a `Range` header asks for, so that a video can be played from
 * any point (Safari asks for every video this way): null for the whole file, `'unsatisfiable'` when
 * none of it can be given. Several ranges, or one written wrong, are answered with the whole file,
 * as HTTP allows (RFC 9110, 14.2).
 */
export function byteRange(header: string | undefined, size: number): ByteRange | 'unsatisfiable' | null {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null
  if (!match || (!match[1] && !match[2])) return null
  if (!match[1]) {
    // The last bytes of the file.
    const last = Number(match[2])
    return last === 0 ? 'unsatisfiable' : { start: Math.max(0, size - last), end: size - 1 }
  }
  const start = Number(match[1])
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  if (start >= size) return 'unsatisfiable'
  return end < start ? null : { start, end }
}
