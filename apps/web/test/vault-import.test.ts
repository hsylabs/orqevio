import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSession, lockVault, unlockSession } from '../src/features/vault/session'
import { type VaultItem, emptyItem } from '../src/features/vault/types'
import { VaultLockedError, importItems } from '../src/features/vault/upload'

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
    unlockSession(await vaultKey(), 'user-1', [], 15)
    const sent: string[] = []
    const result = await importItems(several(6), () => {}, async (id, data) => {
      expect(data).toMatch(/^v1\./)
      sent.push(id)
    })
    expect(result).toEqual({ saved: 6, failed: 0 })
    expect(getSession().items.map((i) => i.id).sort()).toEqual([...sent].sort())
  })

  it('stops when the vault locks and leaves nothing decrypted in memory', async () => {
    unlockSession(await vaultKey(), 'user-1', [], 15)
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
    unlockSession(await vaultKey(), 'user-1', [], 15)
    const fresh = await vaultKey()
    const run = importItems(several(4), () => {}, async () => {
      if (getSession().key !== fresh) unlockSession(fresh, 'user-1', [], 15)
    })
    await expect(run).rejects.toBeInstanceOf(VaultLockedError)
    expect(getSession().key).toBe(fresh)
    expect(getSession().items).toEqual([])
  })
})
