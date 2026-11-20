import { describe, expect, it } from 'vitest'
import { effectiveLength, estimateMasterPassword } from '../src/features/vault/strength'

describe('master password strength', () => {
  it('counts common words, keyboard runs, sequences and repeats as one character each', () => {
    expect(effectiveLength('Password1234')).toBe(2)
    expect(effectiveLength('qwertyuiop')).toBe(1)
    expect(effectiveLength('aaaaaaaaaaaa')).toBe(1)
    expect(effectiveLength('abcdef987654')).toBe(2)
    expect(effectiveLength('caballo-grapa-río')).toBe(17)
  })

  it('does not rate guessable passwords as good', () => {
    for (const weak of ['Password1234', 'Contraseña2026!', 'Qwerty123456', 'aaaaaaaaaaaaaaaa', 'abcdefghijklmnop', 'P@ssw0rd2024!', '1q2w3e4r5t6y', 'W3lc0me!1990', 'qawsedrftgyh', 'Adm1n$ecret2023']) {
      expect(estimateMasterPassword(weak).score, weak).toBeLessThan(2)
    }
  })

  it('sees through letters written with lookalikes, years and walks down the keyboard', () => {
    expect(effectiveLength('p@ssw0rd')).toBe(1)
    expect(effectiveLength('P4$$w0rd')).toBe(1)
    expect(effectiveLength('2024')).toBe(1)
    expect(effectiveLength('1q2w3e4r5t6y')).toBe(1)
    expect(effectiveLength('q1w2e3r4')).toBe(1)
  })

  it('still rates long, varied passwords well', () => {
    expect(estimateMasterPassword('caballo-correcto-grapa-batería').score).toBeGreaterThanOrEqual(2)
    expect(estimateMasterPassword('Tr4m-p0l1n!Verde_Lago').score).toBeGreaterThanOrEqual(2)
  })
})
