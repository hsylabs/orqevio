import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSession, lockVault, unlockSession } from '../src/features/vault/session'
import { type VaultItem, emptyItem } from '../src/features/vault/types'
import { VaultLockedError, importItems } from '../src/features/vault/upload'
import { ApiError } from '../src/lib/api'

const vaultKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
const several = (n: number): VaultItem[] => Array.from({ length: n }, (_, i) => ({ ...emptyItem('login'), title: `Elemento ${i}`, password: `secreto-${i}` }))

describe('importing into the vault', () => {
  beforeEach(() => {
    // The session listens for activity on window.
    vi.stubGlobal('window', new EventTarget())
  })
  afterEach(() => {
    lockVault()
    vi.unstubAllGlobals()
  })

  it('adds what the server accepted to the open session', async () => {
    unlockSession(await vaultKey(), 1, 'user-1', [], 15)
    const sent: string[] = []
    const result = await importItems(several(6), () => {}, async (id, data) => {
      expect(data).toMatch(/^v1\./)
      sent.push(id)
    })
    expect(result).toEqual({ saved: 6, failed: 0 })
    expect(getSession().items.map((i) => i.id).sort()).toEqual([...sent].sort())
  })

  it('sends each item for the version of the key the session holds', async () => {
    unlockSession(await vaultKey(), 7, 'user-1', [], 15)
    const versions: number[] = []
    await importItems(several(3), () => {}, async (_id, _data, keyVersion) => {
      versions.push(keyVersion)
    })
    expect(versions).toEqual([7, 7, 7])
  })

  it('locks and stops when the vault no longer has that key (reset in another tab)', async () => {
    unlockSession(await vaultKey(), 1, 'user-1', [], 15)
    let calls = 0
    const run = importItems(several(40), () => {}, async () => {
      if (++calls === 2) throw new ApiError(409, 'vault_key_changed', 'The vault changed')
    })
    await expect(run).rejects.toMatchObject({ code: 'vault_key_changed' })
    expect(calls).toBeLessThanOrEqual(6)
    expect(getSession()).toMatchObject({ key: null, keyVersion: null, items: [] })
  })

  it('leaves alone a session opened since, when more refusals for the old key come in', async () => {
    unlockSession(await vaultKey(), 1, 'user-1', [], 15)
    let release!: () => void
    const late = new Promise<void>((resolve) => (release = resolve))
    let calls = 0
    const run = importItems(several(8), () => {}, async () => {
      // The first refusal comes at once; the other workers' come after the new vault is open.
      if (++calls > 1) await late
      throw new ApiError(409, 'vault_key_changed', 'The vault changed')
    })
    await expect(run).rejects.toMatchObject({ code: 'vault_key_changed' })
    expect(getSession().key).toBeNull()
    const current = await vaultKey()
    unlockSession(current, 2, 'user-1', [], 15)
    release()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(getSession().key).toBe(current)
  })

  it('stops when the vault locks and leaves nothing decrypted in memory', async () => {
    unlockSession(await vaultKey(), 1, 'user-1', [], 15)
    let calls = 0
    const run = importItems(several(40), () => {}, async () => {
      if (++calls === 3) lockVault()
    })
    await expect(run).rejects.toBeInstanceOf(VaultLockedError)
    // The four workers stop after the item each one had in flight.
    expect(calls).toBeLessThanOrEqual(6)
    expect(getSession()).toMatchObject({ key: null, items: [] })
  })

  it('does not touch a session unlocked again while it was running', async () => {
    unlockSession(await vaultKey(), 1, 'user-1', [], 15)
    const fresh = await vaultKey()
    const run = importItems(several(4), () => {}, async () => {
      if (getSession().key !== fresh) unlockSession(fresh, 1, 'user-1', [], 15)
    })
    await expect(run).rejects.toBeInstanceOf(VaultLockedError)
    expect(getSession().key).toBe(fresh)
    expect(getSession().items).toEqual([])
  })
})
