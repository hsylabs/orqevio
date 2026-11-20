import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { characters } from '../src'

describe('characters, as the limits count them', () => {
  it('counts an emoji or a letter beyond the first 65,536 as one, as zod does', () => {
    expect(characters('')).toBe(0)
    expect(characters('Ñandú')).toBe(5)
    expect(characters('🦤')).toBe(1)
    expect(characters('a🦤b𝔸')).toBe(4)
    // A half on its own is one too.
    expect(characters('\uD83E')).toBe(1)
    expect(characters('\uDD64\uD83E')).toBe(2)
    for (const text of ['🦤'.repeat(10), 'x🦤'.repeat(5), '\uD83Ex', '\uDD64🦤']) {
      const n = characters(text)
      expect(z.string().max(n).safeParse(text).success, text).toBe(true)
      expect(z.string().max(n - 1).safeParse(text).success, text).toBe(false)
    }
  })
})
