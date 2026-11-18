export type VaultItemType = 'login' | 'note'

/** Decrypted vault item. Only ever exists in browser memory. */
export interface VaultItem {
  id: string
  type: VaultItemType
  title: string
  username: string
  password: string
  url: string
  notes: string
  /** Two-step verification secret: an otpauth:// link or a base32 secret ('' when none). */
  totp: string
  favorite: boolean
  createdAt: string
  updatedAt: string
}

/** Longest value the editor accepts for each field. */
export const ITEM_LIMITS = { title: 200, username: 500, password: 1000, url: 2000, totp: 2000, notes: 20_000 } as const

/**
 * An item as the vault keeps it, saved in the editor or imported alike: no spaces around its title,
 * its address or its two-step code (spaces anywhere else may belong to a password or a note).
 */
export const tidyItem = (item: VaultItem): VaultItem => ({ ...item, title: item.title.trim(), url: item.url.trim(), totp: item.totp.trim() })

export const emptyItem = (type: VaultItemType): VaultItem => {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), type, title: '', username: '', password: '', url: '', notes: '', totp: '', favorite: false, createdAt: now, updatedAt: now }
}
