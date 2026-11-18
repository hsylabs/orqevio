import type { VaultItemRecordDTO, VaultStateDTO } from '@orqevio/shared'
import { t } from 'i18next'
import { toast } from 'sonner'
import { ApiError, get } from '../../lib/api'
import { keys, queryClient } from '../../lib/queries'
import { decryptItem } from './crypto'
import { getSession, lockVault, replaceSessionItems, sessionItemChanges, setAutoLock, updateSessionItems } from './session'
import type { VaultItem } from './types'

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

/** Tells the other tabs that items were saved or deleted here: they read them again. */
export function announceVaultItemsChange() {
  channel?.postMessage('items')
}

let reloading: Promise<void> | null = null
let readAgain = false

/**
 * Reads the items again, as the server has them now, into the open session: after another tab
 * saved or deleted some, or when the server refused a save because another device changed the item.
 *
 * One read at a time, so an older one never lands after a newer one. Asked while one is on its
 * way, it reads once more after it, and resolves then.
 */
export function reloadVaultItems(): Promise<void> {
  if (reloading) {
    readAgain = true
    return reloading
  }
  reloading = (async () => {
    try {
      do {
        readAgain = false
        await readItems()
      } while (readAgain)
    } finally {
      reloading = null
    }
  })()
  return reloading
}

/**
 * Puts in the session that holds `key` what a save, delete or import made here got back. When the
 * items changed since it began (`before`, from sessionItemChanges()), a read may have come in
 * meanwhile with newer versions than this answer, which took long: the items are read again.
 */
export function applyItemsChange(key: CryptoKey, before: number, change: (items: VaultItem[]) => VaultItem[], revisions: Record<string, string | null> = {}) {
  const changedMeanwhile = sessionItemChanges() !== before
  const applied = updateSessionItems(key, change, revisions)
  if (applied && changedMeanwhile) void reloadVaultItems().catch(() => {})
  return applied
}

async function readItems() {
  const { key, userId } = getSession()
  if (!key || !userId) return
  const before = sessionItemChanges()
  const records = await get<VaultItemRecordDTO[]>('/vault/items')
  const items: VaultItem[] = []
  const revisions: Record<string, string> = {}
  for (const record of records) {
    try {
      items.push(await decryptItem(key, userId, record.id, record.data))
      revisions[record.id] = record.updatedAt
    } catch {
      // Unlocking already said that some items could not be decrypted.
    }
  }
  if (sessionItemChanges() === before) replaceSessionItems(key, items, revisions)
  // Saved or deleted here meanwhile: what was read may come from before that, so read again
  // (unless the vault locked). Never cleared here: another read may have been asked meanwhile.
  else if (getSession().key === key) readAgain = true
}

if (channel) channel.onmessage = (event: MessageEvent) => void (event.data === 'items' ? reloadVaultItems() : freshVaultState()).catch(() => {})

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
