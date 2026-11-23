// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isConverting, keepOpenOnOwnEscape } from '../src/lib/ime'

// The fields a browser's keydown carries; the unit tests run without a browser.
const key = (init: { key: string; isComposing?: boolean }, keyCode = 13) => ({ isComposing: false, ...init, keyCode }) as KeyboardEvent

describe('a key that belongs to a conversion of an input method', () => {
  it('is the one marked as composing, as Chrome and Firefox send it', () => {
    expect(isConverting(key({ key: 'Enter', isComposing: true }, 229))).toBe(true)
    expect(isConverting(key({ key: 'Escape', isComposing: true }, 229))).toBe(true)
  })

  it('is the Enter Safari sends once the conversion has ended, with key code 229', () => {
    expect(isConverting(key({ key: 'Enter', isComposing: false }, 229))).toBe(true)
  })

  it('is read from what React hands over as well', () => {
    expect(isConverting({ nativeEvent: key({ key: 'Enter', isComposing: true }, 229) } as never)).toBe(true)
    expect(isConverting({ nativeEvent: key({ key: 'Enter' }) } as never)).toBe(false)
  })

  it('is not an Enter or Escape typed on its own', () => {
    expect(isConverting(key({ key: 'Enter' }))).toBe(false)
    expect(isConverting(key({ key: 'Escape' }, 27))).toBe(false)
  })
})

describe('a dialog, sheet or popover that closes on Escape', () => {
  const escape = (keyCode: number, isComposing: boolean) => {
    let prevented = false
    keepOpenOnOwnEscape({ key: 'Escape', keyCode, isComposing, preventDefault: () => (prevented = true) } as unknown as KeyboardEvent)
    return prevented
  }

  it('stays open on the Escape that drops a conversion, and closes on any other', () => {
    expect(escape(229, true)).toBe(true)
    expect(escape(229, false)).toBe(true)
    expect(escape(27, false)).toBe(false)
  })

  it('stays open on an Escape pressed in something that takes it as its own, as the bar of a table', () => {
    document.body.innerHTML = '<div data-own-escape><button id="in">a</button></div><button id="out">b</button>'
    const at = (id: string) => {
      let prevented = false
      keepOpenOnOwnEscape({ key: 'Escape', keyCode: 27, isComposing: false, target: document.getElementById(id), preventDefault: () => (prevented = true) } as unknown as KeyboardEvent)
      return prevented
    }
    expect(at('in')).toBe(true)
    expect(at('out')).toBe(false)
  })
})
