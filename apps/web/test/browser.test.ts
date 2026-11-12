import { describe, expect, it } from 'vitest'
import { vaultBlockers } from '../src/lib/browser'

const browser = (overrides: Record<string, unknown> = {}) =>
  ({ isSecureContext: true, crypto: { subtle: {}, randomUUID: () => 'x' }, Worker: class {}, WebAssembly: {}, ...overrides }) as unknown as typeof globalThis

describe('vault requirements', () => {
  it('are met by a current browser on a secure origin', () => {
    expect(vaultBlockers(browser())).toEqual([])
  })

  it('blame the insecure address first, since it hides WebCrypto', () => {
    expect(vaultBlockers(browser({ isSecureContext: false, crypto: { getRandomValues: () => null } }))).toEqual(['secure_context'])
  })

  it('list every missing feature on an old browser', () => {
    expect(vaultBlockers(browser({ crypto: undefined, Worker: undefined, WebAssembly: undefined }))).toEqual(['webcrypto', 'workers', 'webassembly'])
  })
})
