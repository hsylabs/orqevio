import { describe, expect, it } from 'vitest'
import { clip, defaultWorkspaceName } from '../src'

describe('clip', () => {
  it('keeps text that fits', () => {
    expect(clip('Espacio de Ana', 60)).toBe('Espacio de Ana')
  })

  it('cuts between characters as people see them, within the limit', () => {
    const coder = '👩‍💻' // five UTF-16 units, one character
    const name = defaultWorkspaceName('es', coder.repeat(16))
    const cut = clip(name, 60)
    expect(cut.length).toBeLessThanOrEqual(60)
    expect(cut).toBe(`Espacio de ${coder.repeat(9)}`)
    // An accent stays with its letter.
    expect(clip('café', 4)).toBe('caf')
  })
})
