import { put } from '../../lib/api'
import { encryptItem } from './crypto'
import { getSession, updateSessionItems } from './session'
import type { VaultItem } from './types'

/** The vault was locked before the import could finish. */
export class VaultLockedError extends Error {
  constructor() {
    super('La bóveda está bloqueada.')
  }
}

type Save = (id: string, data: string) => Promise<unknown>
const saveToServer: Save = (id, data) => put(`/vault/items/${id}`, { data })

/**
 * Encrypts and uploads items, a few at a time, and adds the ones the server
 * accepted to the vault session. Stops as soon as that session is locked:
 * nothing it decrypted stays in memory after the lock.
 */
export async function importItems(items: VaultItem[], onProgress: (done: number) => void, save: Save = saveToServer) {
  const { key, userId } = getSession()
  if (!key || !userId) throw new VaultLockedError()
  const unlocked = () => getSession().key === key
  const saved: VaultItem[] = []
  let failed = 0
  let next = 0
  async function worker() {
    while (next < items.length && unlocked()) {
      const item = items[next++]!
      try {
        await save(item.id, await encryptItem(key!, userId!, item))
        saved.push(item)
      } catch {
        failed++
      }
      if (unlocked()) onProgress(saved.length + failed)
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  if (!updateSessionItems(key, (current) => [...current, ...saved])) throw new VaultLockedError()
  return { saved: saved.length, failed }
}
