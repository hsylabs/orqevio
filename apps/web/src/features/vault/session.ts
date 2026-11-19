import { useSyncExternalStore } from 'react'
import { onSessionEnded } from '../../lib/api'
import { keys, queryClient } from '../../lib/queries'
import type { VaultItem } from './types'

/**
 * In-memory vault session. The vault key is a non-extractable CryptoKey that
 * never touches storage; reloading the page or locking discards it.
 */
interface VaultSession {
  key: CryptoKey | null
  /** The version of that key, as the vault had it when the session opened: the server takes items only for it. */
  keyVersion: number | null
  userId: string | null
  items: VaultItem[]
  /**
   * Each item's `updatedAt` as the server has it, sent back with each save or delete: the server
   * refuses it when another tab or device changed the item since.
   */
  revisions: Record<string, string>
  autoLockMinutes: number
  lastActivity: number
}

let session: VaultSession = { key: null, keyVersion: null, userId: null, items: [], revisions: {}, autoLockMinutes: 15, lastActivity: Date.now() }
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null
/** Counts every change of the session's items: a read of the items started before a change is out of date. */
let changes = 0

function emit() {
  for (const l of listeners) l()
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const touch = () => {
  session.lastActivity = Date.now()
}

export function unlockSession(key: CryptoKey, keyVersion: number, userId: string, items: VaultItem[], autoLockMinutes: number, revisions: Record<string, string> = {}) {
  session = { key, keyVersion, userId, items, revisions, autoLockMinutes, lastActivity: Date.now() }
  changes++
  window.addEventListener('pointerdown', touch, { passive: true })
  window.addEventListener('keydown', touch, { passive: true })
  timer ??= setInterval(() => {
    if (session.key && Date.now() - session.lastActivity > session.autoLockMinutes * 60_000) lockVault()
    else emit()
  }, 1000)
  emit()
}

export function lockVault() {
  session = { key: null, keyVersion: null, userId: null, items: [], revisions: {}, autoLockMinutes: session.autoLockMinutes, lastActivity: Date.now() }
  changes++
  window.removeEventListener('pointerdown', touch)
  window.removeEventListener('keydown', touch)
  if (timer) clearInterval(timer)
  timer = null
  emit()
}

const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('orqevio-vault')

/**
 * Locks the vault in this tab and in the other tabs of this browser, told at once: when signing
 * out, restoring a backup, deleting the account or uninstalling. Each drops its key and checks
 * its session, so signing in again asks for the master password everywhere.
 */
export function lockVaultEverywhere() {
  lockVault()
  channel?.postMessage('lock')
}

channel?.addEventListener('message', (event: MessageEvent) => {
  if (event.data !== 'lock') return
  lockVault()
  void queryClient.invalidateQueries({ queryKey: keys.me })
})

// A session that ended elsewhere (signed out in another browser, expired, or gone with a restored
// backup) takes the vault key with it, before the tab goes to the sign-in screen.
onSessionEnded(lockVault)

/**
 * Changes the items of the session that holds `key`. Ignored (false) once that
 * session is locked or replaced, so work that outlives a lock cannot put
 * decrypted items back in memory.
 */
export function updateSessionItems(key: CryptoKey, change: (items: VaultItem[]) => VaultItem[], revisions: Record<string, string | null> = {}) {
  if (session.key !== key) return false
  const next = { ...session.revisions }
  for (const [id, updatedAt] of Object.entries(revisions)) {
    if (updatedAt === null) delete next[id]
    else next[id] = updatedAt
  }
  session = { ...session, items: change(session.items), revisions: next }
  changes++
  emit()
  return true
}

/** Puts the items as the server has them now in the session that holds `key` (false once it is locked or replaced). */
export function replaceSessionItems(key: CryptoKey, items: VaultItem[], revisions: Record<string, string>) {
  if (session.key !== key) return false
  session = { ...session, items, revisions }
  changes++
  emit()
  return true
}

export function setAutoLock(minutes: number) {
  session = { ...session, autoLockMinutes: minutes }
  emit()
}

export const getSession = () => session

/** How many times the session's items changed so far (see `changes`). */
export const sessionItemChanges = () => changes

export function useVaultSession() {
  return useSyncExternalStore(subscribe, () => session)
}

export function useVaultLocked() {
  return useSyncExternalStore(subscribe, () => session.key === null)
}

/** Seconds left before auto-lock (re-rendered every second while unlocked). */
export function useAutoLockRemaining() {
  useSyncExternalStore(subscribe, () => Math.floor(Date.now() / 1000))
  if (!session.key) return 0
  return Math.max(0, Math.round((session.lastActivity + session.autoLockMinutes * 60_000 - Date.now()) / 1000))
}
