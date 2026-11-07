export interface GeneratorOptions {
  length: number
  lower: boolean
  upper: boolean
  digits: boolean
  symbols: boolean
  avoidAmbiguous: boolean
}

export const DEFAULT_GENERATOR: GeneratorOptions = { length: 20, lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: true }

const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!#$%&*+-=?@^_~.,:;',
}
const AMBIGUOUS = /[Il1O0o]/g

/** Unbiased random integer in [0, max) using rejection sampling. */
function randomInt(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max
  const buf = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buf)
    if (buf[0]! < limit) return buf[0]! % max
  }
}

function sets(opts: GeneratorOptions): string[] {
  const chosen = (['lower', 'upper', 'digits', 'symbols'] as const)
    .filter((k) => opts[k])
    .map((k) => (opts.avoidAmbiguous ? SETS[k].replace(AMBIGUOUS, '') : SETS[k]))
  return chosen.length ? chosen : [SETS.lower]
}

/** Generates a password containing at least one character of every selected set. */
export function generatePassword(opts: GeneratorOptions): string {
  const groups = sets(opts)
  const pool = groups.join('')
  const length = Math.max(opts.length, groups.length)
  const chars = groups.map((g) => g[randomInt(g.length)]!)
  while (chars.length < length) chars.push(pool[randomInt(pool.length)]!)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j]!, chars[i]!]
  }
  return chars.join('')
}

export function entropyBits(opts: GeneratorOptions): number {
  return Math.round(Math.max(opts.length, 1) * Math.log2(sets(opts).join('').length))
}

export function strengthLabel(bits: number): { label: string; tone: 'danger' | 'warn' | 'ok' } {
  if (bits < 50) return { label: 'Débil', tone: 'danger' }
  if (bits < 80) return { label: 'Aceptable', tone: 'warn' }
  if (bits < 110) return { label: 'Fuerte', tone: 'ok' }
  return { label: 'Excelente', tone: 'ok' }
}
