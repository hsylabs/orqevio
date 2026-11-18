import type { VaultStateDTO } from '@orqevio/shared'
import { t } from 'i18next'
import { toast } from 'sonner'
import { ApiError, get } from '../../lib/api'
import { keys, queryClient } from '../../lib/queries'
import { getSession, lockVault, setAutoLock } from './session'

/**
 * Keeps every tab's view of the vault current.
 *
 * A tab that changes the vault (sets it up, changes the master password, recovers it, resets it,
 * changes when it locks) tells the other tabs of this browser, and each one reads the vault's
 * state again. Unlocking, recovering and exporting read it fresh too, never from the cache, so
 * they use the master password the vault has now, also after a change on another device.
 *
 * Whenever a tab reads the state, an open session is checked against it. When the vault no longer
 * has that session's key (it was reset, and maybe set up again), the session is locked: anything
 * it encrypted, nobody could open, and the server refuses it anyway.
 */

const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('orqevio-vault')

/** The vault's state as the server has it now, also given to every view of it. */
export const freshVaultState = () => queryClient.fetchQuery({ queryKey: keys.vault, queryFn: ({ signal }) => get<VaultStateDTO>('/vault', signal), staleTime: 0 })

/** Tells the other tabs that the vault changed. */
export function announceVaultChange() {
  channel?.postMessage('changed')
}

if (channel) channel.onmessage = () => void freshVaultState().catch(() => {})

queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== 'updated' || event.action.type !== 'success' || event.query.queryKey[0] !== keys.vault[0]) return
  const state = event.query.state.data as VaultStateDTO | undefined
  const session = getSession()
  if (!state || !session.key) return
  if (!state.initialized || state.keyVersion !== session.keyVersion) {
    lockVault()
    toast.info(t('errors:codes.vault_key_changed'))
  } else if (state.autoLockMinutes !== session.autoLockMinutes) {
    setAutoLock(state.autoLockMinutes)
  }
})

/** The server refused something for a vault key the vault no longer has: locks, and reads the state again. */
export function lockIfVaultChanged(error: unknown) {
  if (!(error instanceof ApiError && error.code === 'vault_key_changed')) return false
  lockVault()
  void freshVaultState().catch(() => {})
  return true
}
