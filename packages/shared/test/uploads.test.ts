import { describe, expect, it } from 'vitest'
import { withoutBidiControls } from '../src/uploads'

describe('file names as they truly are', () => {
  it('lose the characters that show them in another order', () => {
    expect(withoutBidiControls('‮gnp.exe')).toBe('gnp.exe')
    expect(withoutBidiControls('a‪b‫c‬d‭e')).toBe('abcde')
    expect(withoutBidiControls('x⁦y⁧z⁨w⁩.pdf')).toBe('xyzw.pdf')
    expect(withoutBidiControls('‎nota‏؜.txt')).toBe('nota.txt')
  })

  it('keep everything else: other scripts, joined emoji, joiners that words need', () => {
    for (const name of ['تقرير.pdf', 'דוח.pdf', 'informe año.pdf', '👨‍👩‍👧 familia.png', 'می‌خواهم.txt', '日本語.docx']) {
      expect(withoutBidiControls(name)).toBe(name)
    }
  })
})
