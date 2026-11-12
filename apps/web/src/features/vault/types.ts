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

export const emptyItem = (type: VaultItemType): VaultItem => {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), type, title: '', username: '', password: '', url: '', notes: '', totp: '', favorite: false, createdAt: now, updatedAt: now }
}
