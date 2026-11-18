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
 * it encrypted, nobody could open, and the server refuses it anyway. Key versions only go up, so a
 * state older than the session (a reply that took long to come) is no reason to lock it.
 */

const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('orqevio-vault')

const fetchState = () => queryClient.fetchQuery({ queryKey: keys.vault, queryFn: ({ signal }) => get<VaultStateDTO>('/vault', signal), staleTime: 0 })

/**
 * The vault's state as the server has it now, also given to every view of it. A request already on
 * its way is not enough, as it may have read the state before the change that prompts this one:
 * it is let finish, and the state is read again.
 */
export async function freshVaultState() {
  if (queryClient.isFetching({ queryKey: keys.vault })) await fetchState().catch(() => {})
  return fetchState()
}

/** Tells the other tabs that the vault changed. */
export function announceVaultChange() {
  channel?.postMessage('changed')
}

if (channel) channel.onmessage = () => void freshVaultState().catch(() => {})

queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== 'updated' || event.action.type !== 'success' || event.query.queryKey[0] !== keys.vault[0]) return
  const state = event.query.state.data as VaultStateDTO | undefined
  const session = getSession()
  if (!state || !session.key || session.keyVersion === null) return
  const replaced = state.keyVersion > session.keyVersion || (state.keyVersion === session.keyVersion && !state.initialized)
  if (replaced) {
    lockVault()
    toast.info(t('errors:codes.vault_key_changed'))
  } else if (state.autoLockMinutes !== session.autoLockMinutes) {
    setAutoLock(state.autoLockMinutes)
  }
})

/**
 * The server refused something sent with `key`, a vault key the vault no longer has: locks the
 * session that holds it, if it is still the open one (not one opened since), and reads the state again.
 */
export function lockIfVaultChanged(error: unknown, key: CryptoKey | null) {
  if (!(error instanceof ApiError && error.code === 'vault_key_changed')) return false
  if (key && getSession().key === key) lockVault()
  void freshVaultState().catch(() => {})
  return true
}
