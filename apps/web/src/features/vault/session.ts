import { useSyncExternalStore } from 'react'
import type { VaultItem } from './types'

/**
 * In-memory vault session. The vault key is a non-extractable CryptoKey that
 * never touches storage; reloading the page or locking discards it.
 */
interface VaultSession {
  key: CryptoKey | null
  userId: string | null
  items: VaultItem[]
  autoLockMinutes: number
  lastActivity: number
}

let session: VaultSession = { key: null, userId: null, items: [], autoLockMinutes: 15, lastActivity: Date.now() }
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

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

export function unlockSession(key: CryptoKey, userId: string, items: VaultItem[], autoLockMinutes: number) {
  session = { key, userId, items, autoLockMinutes, lastActivity: Date.now() }
  window.addEventListener('pointerdown', touch, { passive: true })
  window.addEventListener('keydown', touch, { passive: true })
  timer ??= setInterval(() => {
    if (session.key && Date.now() - session.lastActivity > session.autoLockMinutes * 60_000) lockVault()
    else emit()
  }, 1000)
  emit()
}

export function lockVault() {
  session = { key: null, userId: null, items: [], autoLockMinutes: session.autoLockMinutes, lastActivity: Date.now() }
  window.removeEventListener('pointerdown', touch)
  window.removeEventListener('keydown', touch)
  if (timer) clearInterval(timer)
  timer = null
  emit()
}

export function setSessionItems(items: VaultItem[]) {
  session = { ...session, items }
  emit()
}

export function setAutoLock(minutes: number) {
  session = { ...session, autoLockMinutes: minutes }
  emit()
}

export const getSession = () => session

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
