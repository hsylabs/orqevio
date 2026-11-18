import type { VaultItemRecordDTO } from '@orqevio/shared'
import { ApiError, put } from '../../lib/api'
import { encryptItem } from './crypto'
import { getSession, lockVault, sessionItemChanges } from './session'
import { announceVaultItemsChange, applyItemsChange } from './sync'
import type { VaultItem } from './types'

/** The vault was locked before the import could finish. The message is for developers: the import dialog explains it to people. */
export class VaultLockedError extends Error {
  constructor() {
    super('The vault is locked')
  }
}

/** Returns the record saved, with its `updatedAt` (the version the next save must name). */
type Save = (id: string, data: string, keyVersion: number) => Promise<Partial<VaultItemRecordDTO> | undefined | void>
// New items: refused, rather than overwritten, if one with the same id appeared in the meantime.
const saveToServer: Save = (id, data, keyVersion) => put<VaultItemRecordDTO>(`/vault/items/${id}`, { data, keyVersion, baseUpdatedAt: null })

/**
 * Encrypts and uploads items, a few at a time, and adds the ones the server
 * accepted to the vault session. Stops as soon as that session is locked:
 * nothing it decrypted stays in memory after the lock. When the vault no longer
 * has this session's key (reset in another tab), it locks it and stops with that error.
 */
export async function importItems(items: VaultItem[], onProgress: (done: number) => void, save: Save = saveToServer) {
  const { key, keyVersion, userId } = getSession()
  if (!key || keyVersion === null || !userId) throw new VaultLockedError()
  const unlocked = () => getSession().key === key
  const before = sessionItemChanges()
  const saved: VaultItem[] = []
  const revisions: Record<string, string> = {}
  let failed = 0
  let next = 0
  async function worker() {
    while (next < items.length && unlocked()) {
      const item = items[next++]!
      try {
        const record = await save(item.id, await encryptItem(key!, userId!, item), keyVersion!)
        if (record?.updatedAt) revisions[item.id] = record.updatedAt
        saved.push(item)
      } catch (error) {
        if (error instanceof ApiError && error.code === 'vault_key_changed') {
          // This session's key, unless another session was opened since (the new vault's, say).
          if (unlocked()) lockVault()
          throw error
        }
        failed++
      }
      if (unlocked()) onProgress(saved.length + failed)
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  // By id: the items may be read again meanwhile (another tab saved one), with some of these already in.
  const ids = new Set(saved.map((i) => i.id))
  if (!applyItemsChange(key, before, (current) => [...current.filter((i) => !ids.has(i.id)), ...saved], revisions)) throw new VaultLockedError()
  if (saved.length) announceVaultItemsChange()
  return { saved: saved.length, failed }
}
