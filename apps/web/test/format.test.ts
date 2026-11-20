import { describe, expect, it } from 'vitest'
import { initials, monogram } from '../src/lib/format'

describe('the letter on a tile and the initials on an avatar', () => {
  it('take the first character whole, an emoji included, never half of one', () => {
    expect(monogram('🚀 Lanzamiento')).toBe('🚀')
    expect(monogram('👩‍💻 Equipo')).toBe('👩‍💻')
    expect(monogram('🇪🇸 España')).toBe('🇪🇸')
    expect(monogram('é̃tude')).toBe('É̃')
    expect(initials('🎨 Diseño')).toBe('🎨D')
    expect(initials('Ana 🌻')).toBe('A🌻')
    for (const shown of [monogram('🚀 Lanzamiento'), initials('🎨 Diseño'), initials('Ana 🌻')]) expect(shown).not.toMatch(/�|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })

  it('in capitals, unless that makes two characters of one', () => {
    expect(monogram('orqevio')).toBe('O')
    expect(monogram('ßtraße')).toBe('ß')
    expect(initials('ana ruiz')).toBe('AR')
  })

  it('a dot when there is nothing to show', () => {
    expect(monogram('')).toBe('·')
    expect(monogram('   ')).toBe('·')
    expect(initials('')).toBe('·')
  })
})
