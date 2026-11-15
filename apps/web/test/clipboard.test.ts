// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelClipboardClear, clearClipboardLater, clearClipboardNow } from '../src/lib/clipboard'

/** A browser's clipboard: writable only with the focus (or always, as after a click), readable only if granted. */
let clipboard = ''
let focused = true
let writesNeedActivation = false
let activation = false
let readPermission: 'granted' | 'prompt' | 'unsupported' = 'prompt'
let ask: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  clipboard = ''
  focused = true
  writesNeedActivation = false
  activation = false
  readPermission = 'prompt'
  ask = vi.fn()
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (focused ? 'visible' : 'hidden') })
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: vi.fn(async (text: string) => {
        if (!focused || (writesNeedActivation && !activation)) throw new DOMException('Not allowed', 'NotAllowedError')
        clipboard = text
      }),
      readText: vi.fn(async () => clipboard),
    },
  })
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: {
      query: vi.fn(async () => {
        if (readPermission === 'unsupported') throw new TypeError('clipboard-read is not a permission name')
        return { state: readPermission }
      }),
    },
  })
})
afterEach(() => {
  cancelClipboardClear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** The person copies a secret, as the copy button does. */
function copySecret(value = 'contraseña') {
  clipboard = value
  clearClipboardLater(value, 30_000, ask)
}
function leave() {
  focused = false
  window.dispatchEvent(new Event('blur'))
}
async function comeBack() {
  focused = true
  window.dispatchEvent(new Event('focus'))
  await vi.advanceTimersByTimeAsync(0)
}

describe('clearing a copied secret from the clipboard', () => {
  it('clears it once the time is up when the page kept the focus', async () => {
    copySecret()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(clipboard).toBe('contraseña')
    await vi.advanceTimersByTimeAsync(1)
    expect(clipboard).toBe('')
    expect(ask).not.toHaveBeenCalled()
  })

  it('leaves the clipboard alone when something else was copied from the page', async () => {
    copySecret()
    document.dispatchEvent(new Event('copy'))
    clipboard = 'otra cosa'
    await vi.advanceTimersByTimeAsync(30_000)
    expect(clipboard).toBe('otra cosa')
    expect(ask).not.toHaveBeenCalled()
  })

  it('forgets the secret when anything else is copied with a copy button', async () => {
    copySecret()
    cancelClipboardClear()
    clipboard = 'https://copia.example/mcp'
    await vi.advanceTimersByTimeAsync(30_000)
    expect(clipboard).toBe('https://copia.example/mcp')
  })

  it('tracks only the last secret', async () => {
    copySecret('primera')
    await vi.advanceTimersByTimeAsync(20_000)
    copySecret('segunda')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(clipboard).toBe('segunda')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(clipboard).toBe('')
  })

  it('waits for the page to come back, then clears the secret if it can see it is still there', async () => {
    readPermission = 'granted'
    copySecret()
    leave()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(clipboard).toBe('contraseña')
    await comeBack()
    expect(clipboard).toBe('')
    expect(ask).not.toHaveBeenCalled()
  })

  it('keeps what was copied elsewhere meanwhile, when it can see it', async () => {
    readPermission = 'granted'
    copySecret()
    leave()
    clipboard = 'copiado en otra aplicación'
    await vi.advanceTimersByTimeAsync(30_000)
    await comeBack()
    expect(clipboard).toBe('copiado en otra aplicación')
    expect(ask).not.toHaveBeenCalled()
  })

  it('asks once the page is back when it can neither see the clipboard nor know it is untouched', async () => {
    for (const permission of ['prompt', 'unsupported'] as const) {
      readPermission = permission
      ask.mockClear()
      copySecret()
      leave()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(ask).not.toHaveBeenCalled()
      await comeBack()
      expect(ask).toHaveBeenCalledTimes(1)
      expect(clipboard).toBe('contraseña')
      // Nothing more happens afterwards: the reminder is the person's to use.
      await comeBack()
      expect(ask).toHaveBeenCalledTimes(1)
    }
    // Never asks for the permission to read the clipboard.
    expect(navigator.clipboard.readText).not.toHaveBeenCalled()
  })

  it('asks when the browser only lets a click write to the clipboard, and the click clears it', async () => {
    writesNeedActivation = true
    copySecret()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(clipboard).toBe('contraseña')
    activation = true
    expect(await clearClipboardNow()).toBe(true)
    expect(clipboard).toBe('')
  })
})
