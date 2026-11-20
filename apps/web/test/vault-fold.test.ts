import { describe, expect, it } from 'vitest'
import { fold } from '../src/features/vault/fold'

describe('searching the vault without accents', () => {
  it('finds letters with no accent to take off as people type them', () => {
    expect(fold('Música')).toBe('musica')
    expect(fold('Straße')).toBe('strasse')
    expect(fold('Œuvre')).toBe('oeuvre')
    expect(fold('Ærøskøbing')).toBe('aeroskobing')
    expect(fold('Łódź')).toBe('lodz')
    expect(fold('İstanbul')).toBe('istanbul')
    expect(fold('Banco Ñandú')).toContain(fold('nandu'))
  })
})
