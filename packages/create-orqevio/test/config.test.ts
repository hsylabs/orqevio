import { describe, expect, it } from 'vitest'
import { bucketName, isValidName } from '../src/config'
import { generateSetupCode } from '../src/setup-code'

describe('copy names', () => {
  it('accepts names that fit a workers.dev label and an R2 bucket', () => {
    for (const ok of ['orqevio', 'a', 'mi-copia-2', 'x'.repeat(50)]) expect(isValidName(ok)).toBe(true)
    for (const bad of ['', 'Orqevio', 'mi copia', '-copia', 'copia-', 'mi_copia', 'x'.repeat(51), 'ñandú']) expect(isValidName(bad)).toBe(false)
    expect(bucketName('x'.repeat(50)).length).toBeLessThanOrEqual(63)
  })
})

describe('setup codes', () => {
  it('match the server format: 80 bits of Crockford base32 in groups of four', () => {
    const code = generateSetupCode()
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/)
    expect(generateSetupCode()).not.toBe(code)
    expect(generateSetupCode(new Uint8Array(10))).toBe('0000-0000-0000-0000')
    expect(generateSetupCode(new Uint8Array(10).fill(255))).toBe('ZZZZ-ZZZZ-ZZZZ-ZZZZ')
  })
})
