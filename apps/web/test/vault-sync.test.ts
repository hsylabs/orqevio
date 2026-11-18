import type { VaultStateDTO } from '@orqevio/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptItem } from '../src/features/vault/crypto'
import { getSession, lockVault, replaceSessionItems, sessionItemChanges, unlockSession, updateSessionItems } from '../src/features/vault/session'
import { applyItemsChange, freshVaultState, lockIfVaultChanged, reloadVaultItems } from '../src/features/vault/sync'
import { type VaultItem, emptyItem } from '../src/features/vault/types'
import { ApiError } from '../src/lib/api'
import { keys, queryClient } from '../src/lib/queries'

const vaultKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
const login = (id: string, password: string): VaultItem => ({ ...emptyItem('login'), id, title: id, password })
const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
/** The server's records of `items`, encrypted with `key`, as GET /vault/items returns them. */
const records = (key: CryptoKey, items: VaultItem[], updatedAt: string) =>
  Promise.all(items.map(async (i) => ({ id: i.id, data: await encryptItem(key, 'user-1', i), createdAt: updatedAt, updatedAt })))
const passwords = () => getSession().items.map((i) => `${i.id}:${i.password}`).sort()

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
  it('reads the items one read at a time: an older read never lands after a newer one', async () => {
    const key = await vaultKey()
    unlockSession(key, 1, 'user-1', [login('correo', 'Antigua-1111')], 15)
    const older = await records(key, [login('correo', 'Antigua-1111')], '2026-11-18T10:00:00.000Z')
    const newer = await records(key, [login('correo', 'Nueva-2222')], '2026-11-18T10:00:01.000Z')
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    // The first read is slow and has the older version; any read after it has the newer one.
    const fetch = vi.fn(async () => {
      if (fetch.mock.calls.length === 1) {
        await held
        return reply(older)
      }
      return reply(newer)
    })
    vi.stubGlobal('fetch', fetch)
    const first = reloadVaultItems()
    const second = reloadVaultItems()
    release()
    await Promise.all([first, second])
    expect(passwords()).toEqual(['correo:Nueva-2222'])
    expect(getSession().revisions).toEqual({ correo: '2026-11-18T10:00:01.000Z' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('reads the items again when one is saved here while they are read', async () => {
    const key = await vaultKey()
    unlockSession(key, 1, 'user-1', [], 15)
    const before = await records(key, [], '2026-11-18T10:00:00.000Z')
    const after = await records(key, [login('banco', 'Uno-1111')], '2026-11-18T10:00:01.000Z')
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const fetch = vi.fn(async () => {
      if (fetch.mock.calls.length === 1) {
        await held
        return reply(before)
      }
      return reply(after)
    })
    vi.stubGlobal('fetch', fetch)
    const reload = reloadVaultItems()
    // Saved here while the read, from before the save, is on its way.
    updateSessionItems(key, (items) => [...items, login('banco', 'Uno-1111')], { banco: '2026-11-18T10:00:01.000Z' })
    release()
    await reload
    expect(passwords()).toEqual(['banco:Uno-1111'])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('stops reading the items once the vault locks', async () => {
    const key = await vaultKey()
    unlockSession(key, 1, 'user-1', [login('correo', 'Antigua-1111')], 15)
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const later = await records(key, [login('correo', 'Nueva-2222')], '2026-11-18T10:00:01.000Z')
    const fetch = vi.fn(async () => {
      await held
      return reply(later)
    })
    vi.stubGlobal('fetch', fetch)
    const reload = reloadVaultItems()
    lockVault()
    release()
    await reload
    expect(getSession()).toMatchObject({ key: null, items: [] })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('puts what a save got back in the session, and reads nothing more when nothing changed meanwhile', async () => {
    const key = await vaultKey()
    unlockSession(key, 1, 'user-1', [login('correo', 'Antigua-1111')], 15)
    const fetch = vi.fn(async () => reply([]))
    vi.stubGlobal('fetch', fetch)
    const before = sessionItemChanges()
    expect(applyItemsChange(key, before, (items) => items.map((i) => ({ ...i, password: 'Nueva-2222' })), { correo: '2026-11-18T10:00:01.000Z' })).toBe(true)
    expect(passwords()).toEqual(['correo:Nueva-2222'])
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reads the items again when a save is answered after they were read again', async () => {
    const key = await vaultKey()
    unlockSession(key, 1, 'user-1', [login('correo', 'Antigua-1111')], 15)
    // The save is on its way; meanwhile another tab deleted the item, and this tab read the items again.
    const before = sessionItemChanges()
    replaceSessionItems(key, [], {})
    const fetch = vi.fn(async () => reply([]))
    vi.stubGlobal('fetch', fetch)
    // The save's answer, older than that read, comes last.
    applyItemsChange(key, before, (items) => [...items, login('correo', 'Nueva-2222')], { correo: '2026-11-18T10:00:01.000Z' })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(getSession().items).toEqual([]))
    expect(getSession().revisions).toEqual({})
  })
  it('keeps a read asked by a vault opened again while an older read was on its way', async () => {
    const old = await vaultKey()
    unlockSession(old, 1, 'user-1', [], 15)
    const current = await vaultKey()
    const forOld = await records(old, [login('banco', 'Uno-1111')], '2026-11-18T10:00:01.000Z')
    const forCurrent = await records(current, [login('banco', 'Dos-2222')], '2026-11-18T10:00:02.000Z')
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const fetch = vi.fn(async () => {
      if (fetch.mock.calls.length === 1) {
        await held
        return reply(forOld)
      }
      return reply(forCurrent)
    })
    vi.stubGlobal('fetch', fetch)
    const first = reloadVaultItems()
    // Locked and opened again while that read is on its way; the vault opened now asks for a read.
    lockVault()
    unlockSession(current, 1, 'user-1', [], 15)
    const second = reloadVaultItems()
    release()
    await Promise.all([first, second])
    expect(passwords()).toEqual(['banco:Dos-2222'])
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
