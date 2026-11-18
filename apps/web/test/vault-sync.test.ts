import type { VaultStateDTO } from '@orqevio/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSession, lockVault, unlockSession } from '../src/features/vault/session'
import { lockIfVaultChanged } from '../src/features/vault/sync'
import { ApiError } from '../src/lib/api'
import { keys, queryClient } from '../src/lib/queries'

const vaultKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
const state = (change: Partial<VaultStateDTO> = {}): VaultStateDTO => ({ initialized: true, kdf: null, wrappedKey: 'v1.a.b', recoveryWrappedKey: 'v1.c.d', autoLockMinutes: 15, keyVersion: 1, ...change })

describe('keeping the vault session in step with the vault', () => {
  beforeEach(() => {
    vi.stubGlobal('window', new EventTarget())
  })
  afterEach(() => {
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

  it('locks when the server refuses something for an old key, and only then', async () => {
    unlockSession(await vaultKey(), 1, 'user-1', [], 15)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(state({ keyVersion: 2 })), { headers: { 'Content-Type': 'application/json' } })))
    expect(lockIfVaultChanged(new ApiError(409, 'conflict', 'Something else'))).toBe(false)
    expect(getSession().key).not.toBeNull()
    expect(lockIfVaultChanged(new ApiError(409, 'vault_key_changed', 'The vault changed'))).toBe(true)
    expect(getSession().key).toBeNull()
  })
})
