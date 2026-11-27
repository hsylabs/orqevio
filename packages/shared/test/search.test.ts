import { describe, expect, it } from 'vitest'
import { searchable } from '../src'

describe('searchable', () => {
  it('waits for two characters, or one in a script written without spaces', () => {
    expect(searchable('')).toBe(false)
    expect(searchable(' a ')).toBe(false)
    expect(searchable('é')).toBe(false)
    expect(searchable('ok')).toBe(true)
    // One character is often a word in Japanese, Chinese or Thai.
    expect(searchable('猫')).toBe(true)
    expect(searchable(' 本 ')).toBe(true)
    expect(searchable('ก')).toBe(true)
    // An emoji is two UTF-16 units, but one character.
    expect(searchable('🚀')).toBe(false)
  })
})
