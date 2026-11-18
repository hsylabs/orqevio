import type { VaultStateDTO } from '@orqevio/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSession, lockVault, unlockSession } from '../src/features/vault/session'
import { freshVaultState, lockIfVaultChanged } from '../src/features/vault/sync'
import { ApiError } from '../src/lib/api'
import { keys, queryClient } from '../src/lib/queries'

const vaultKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
const state = (change: Partial<VaultStateDTO> = {}): VaultStateDTO => ({ initialized: true, kdf: null, wrappedKey: 'v1.a.b', recoveryWrappedKey: 'v1.c.d', autoLockMinutes: 15, keyVersion: 1, ...change })

describe('keeping the vault session in step with the vault', () => {
  beforeEach(() => {
    vi.stubGlobal('window', new EventTarget())
  })
  afterEach(async () => {
    // A refresh a test started (and the one it chains, a task later) ends with that test's server, not the next one's.
    await vi.waitFor(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(queryClient.isFetching()).toBe(0)
    })
    lockVault()
    queryClient.clear()
    vi.unstubAllGlobals()
  })

  it('keeps a session open while the vault has its key, and takes a new auto-lock time from another tab', async () => {
    unlockSession(await vaultKey(), 1, 'user-1', [], 15)
    queryClient.setQueryData(keys.vault, state({ wrappedKey: 'v1.new.password' }))
    expect(getSession().key).not.toBeNull()
    queryClient.setQueryData(keys.vault, state({ autoLockMinutes: 5 }))
    expect(getSession()).toMatchObject({ keyVersion: 1, autoLockMinutes: 5 })
  })

  it('locks a session whose key the vault no longer has: reset, or reset and set up again', async () => {
    unlockSession(await vaultKey(), 1, 'user-1', [], 15)
    queryClient.setQueryData(keys.vault, state({ initialized: false, wrappedKey: null, recoveryWrappedKey: null }))
    expect(getSession()).toMatchObject({ key: null, items: [] })

    unlockSession(await vaultKey(), 1, 'user-1', [], 15)
    queryClient.setQueryData(keys.vault, state({ keyVersion: 2 }))
    expect(getSession()).toMatchObject({ key: null, items: [] })
  })

  it('keeps a session open when an older state comes in late', async () => {
    unlockSession(await vaultKey(), 2, 'user-1', [], 15)
    // Read before this vault was set up, or before the reset that came before it.
    queryClient.setQueryData(keys.vault, state({ initialized: false, keyVersion: 1 }))
    queryClient.setQueryData(keys.vault, state({ keyVersion: 1 }))
    expect(getSession()).toMatchObject({ keyVersion: 2 })
    expect(getSession().key).not.toBeNull()
  })

  it('locks when the server refuses something for an old key, and only the session that sent it', async () => {
    const old = await vaultKey()
    unlockSession(old, 1, 'user-1', [], 15)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(state({ keyVersion: 2 })), { headers: { 'Content-Type': 'application/json' } })))
    expect(lockIfVaultChanged(new ApiError(409, 'conflict', 'Something else'), old)).toBe(false)
    expect(getSession().key).toBe(old)
    // A reply for the old key that comes once the new vault is open leaves the new session alone.
    const current = await vaultKey()
    unlockSession(current, 2, 'user-1', [], 15)
    expect(lockIfVaultChanged(new ApiError(409, 'vault_key_changed', 'The vault changed'), old)).toBe(true)
    expect(getSession().key).toBe(current)
    expect(lockIfVaultChanged(new ApiError(409, 'vault_key_changed', 'The vault changed'), current)).toBe(true)
    expect(getSession().key).toBeNull()
  })

  it('reads the state again when a request already on its way may have read it before a change', async () => {
    const replies = [state({ keyVersion: 1 }), state({ keyVersion: 2 })]
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const fetch = vi.fn(async () => {
      const reply = replies[fetch.mock.calls.length - 1]!
      if (reply.keyVersion === 1) await held
      return new Response(JSON.stringify(reply), { headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetch)
    // A request on its way (a refresh as the tab came back, say), then another tab announces a change.
    const before = freshVaultState()
    const after = freshVaultState()
    release()
    expect((await before).keyVersion).toBe(1)
    expect((await after).keyVersion).toBe(2)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
