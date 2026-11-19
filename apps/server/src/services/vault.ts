import type { VaultItemRecordDTO, VaultSetupDTO, VaultStateDTO } from '@orqevio/shared'
import { MAX_VAULT_ITEMS, vaultItemInput, vaultKeysInput, vaultRekeyInput, vaultSettingsInput } from '@orqevio/shared'
import { and, asc, count, eq } from 'drizzle-orm'
import type { Actor } from '../auth/actor'
import { vaultItems, vaults } from '../db/schema'
import { AppError, conflict, forbidden, notFound } from '../lib/errors'
import { parse } from '../lib/validate'
import type { Access } from './access'
import type { Deps } from './deps'

/**
 * A tab or a device holds a vault key the vault no longer has: it was reset, and maybe set up
 * again, since that tab opened it. What it encrypts now nobody could open, so it is refused.
 */
const keyChanged = () => new AppError(409, 'vault_key_changed', 'The vault changed since it was opened here: open it again')
const itemChanged = () => new AppError(409, 'vault_item_changed', 'This item changed in another tab or device since it was opened here')

/**
 * The vault stores opaque, client-side encrypted envelopes. The server has no
 * key material and cannot decrypt anything. Every method requires a browser
 * session: agent tokens are rejected before any vault data is read.
 *
 * Each vault key has a version (it goes up each time the vault is set up), and items
 * and new wrappings of the key are only taken for the version the vault has now.
 */
export class VaultService {
  constructor(
    private readonly deps: Deps,
    private readonly access: Access,
  ) {}

  private guard(actor: Actor): asserts actor is Extract<Actor, { kind: 'user' }> {
    if (actor.kind !== 'user') {
      throw forbidden('The vault is never accessible to agents or API tokens.', 'vault_isolated')
    }
  }

  async state(actor: Actor): Promise<VaultStateDTO> {
    this.guard(actor)
    const [v] = await this.deps.db.select().from(vaults).where(eq(vaults.userId, actor.userId))
    return {
      initialized: Boolean(v?.wrappedKey),
      kdf: v?.kdf ?? null,
      wrappedKey: v?.wrappedKey ?? null,
      recoveryWrappedKey: v?.recoveryWrappedKey ?? null,
      autoLockMinutes: v?.autoLockMinutes ?? 15,
      keyVersion: v?.keyVersion ?? 0,
    }
  }

  /**
   * A new vault key: its version is one more than the last one this person's vault had. It is
   * given back with the write, so the tab that set it up holds the version of its own key, even
   * if another tab resets the vault and sets it up again right after.
   */
  async setup(actor: Actor, input: unknown): Promise<VaultSetupDTO> {
    this.guard(actor)
    const keys = parse(vaultKeysInput, input)
    return this.deps.db.transaction((tx) => {
      const existing = tx
        .select({ wrappedKey: vaults.wrappedKey, keyVersion: vaults.keyVersion, autoLockMinutes: vaults.autoLockMinutes })
        .from(vaults)
        .where(eq(vaults.userId, actor.userId))
        .get()
      if (existing?.wrappedKey) throw conflict('The vault is already set up')
      const keyVersion = (existing?.keyVersion ?? 0) + 1
      tx.insert(vaults)
        .values({ userId: actor.userId, ...keys, keyVersion })
        .onConflictDoUpdate({ target: vaults.userId, set: { ...keys, keyVersion, updatedAt: new Date() } })
        .run()
      return { keyVersion, autoLockMinutes: existing?.autoLockMinutes ?? 15 }
    })
  }

  /**
   * Re-wraps the vault key (new master password or recovery). Item ciphertexts are untouched.
   * Only for the key the vault has now: wrappings of an older one would replace it.
   */
  async rekey(actor: Actor, input: unknown) {
    this.guard(actor)
    const { keyVersion, ...keys } = parse(vaultRekeyInput, input)
    this.deps.db.transaction((tx) => {
      const vault = tx.select({ wrappedKey: vaults.wrappedKey, keyVersion: vaults.keyVersion }).from(vaults).where(eq(vaults.userId, actor.userId)).get()
      if (!vault) throw notFound('Vault')
      // Reset since (set up again or not): the key this tab holds is gone.
      if (!vault.wrappedKey || vault.keyVersion !== keyVersion) throw keyChanged()
      tx.update(vaults).set({ ...keys, updatedAt: new Date() }).where(eq(vaults.userId, actor.userId)).run()
    })
  }

  async updateSettings(actor: Actor, input: unknown) {
    this.guard(actor)
    const { autoLockMinutes } = parse(vaultSettingsInput, input)
    await this.deps.db
      .insert(vaults)
      .values({ userId: actor.userId, autoLockMinutes })
      .onConflictDoUpdate({ target: vaults.userId, set: { autoLockMinutes, updatedAt: new Date() } })
  }

  async items(actor: Actor): Promise<VaultItemRecordDTO[]> {
    this.guard(actor)
    const rows = await this.deps.db.select().from(vaultItems).where(eq(vaultItems.userId, actor.userId)).orderBy(asc(vaultItems.createdAt))
    return rows.map((r) => ({ id: r.id, data: r.data, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }))
  }

  /** Saves an item encrypted with the vault key the vault has now, checked and written at once. */
  async putItem(actor: Actor, itemId: string, input: unknown): Promise<VaultItemRecordDTO> {
    this.guard(actor)
    const { data, keyVersion, baseUpdatedAt } = parse(vaultItemInput, input)
    const row = this.deps.db.transaction((tx) => {
      const vault = tx.select({ wrappedKey: vaults.wrappedKey, keyVersion: vaults.keyVersion }).from(vaults).where(eq(vaults.userId, actor.userId)).get()
      if (!vault) throw conflict('Set up the vault first')
      // Reset since this tab opened it, whether it was set up again or not: its key is gone.
      if (!vault.wrappedKey || vault.keyVersion !== keyVersion) throw keyChanged()
      const owner = tx.select({ userId: vaultItems.userId, updatedAt: vaultItems.updatedAt }).from(vaultItems).where(eq(vaultItems.id, itemId)).get()
      if (owner && owner.userId !== actor.userId) throw notFound('Item')
      // Saved from what this tab had: refused when another tab or device changed or deleted it since.
      if (baseUpdatedAt !== undefined && (owner ? owner.updatedAt.toISOString() : null) !== baseUpdatedAt) throw itemChanged()
      if (!owner) {
        const stored = tx.select({ n: count() }).from(vaultItems).where(eq(vaultItems.userId, actor.userId)).get()
        if ((stored?.n ?? 0) >= MAX_VAULT_ITEMS) throw new AppError(409, 'vault_full', `The vault holds up to ${MAX_VAULT_ITEMS} items`)
      }
      // Always later than the version it replaces, even within the same millisecond: it is what tabs compare.
      const updatedAt = new Date(Math.max(Date.now(), (owner?.updatedAt.getTime() ?? 0) + 1))
      return tx
        .insert(vaultItems)
        .values({ id: itemId, userId: actor.userId, data, keyVersion, updatedAt })
        .onConflictDoUpdate({ target: vaultItems.id, set: { data, keyVersion, updatedAt }, where: eq(vaultItems.userId, actor.userId) })
        .returning()
        .get()
    })
    return { id: row.id, data: row.data, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
  }

  /** `baseUpdatedAt`, as for putItem: refused when the item changed since this tab read it. */
  async deleteItem(actor: Actor, itemId: string, baseUpdatedAt?: string) {
    this.guard(actor)
    this.deps.db.transaction((tx) => {
      const row = tx.select({ updatedAt: vaultItems.updatedAt }).from(vaultItems).where(and(eq(vaultItems.id, itemId), eq(vaultItems.userId, actor.userId))).get()
      if (!row) throw notFound('Item')
      if (baseUpdatedAt !== undefined && row.updatedAt.toISOString() !== baseUpdatedAt) throw itemChanged()
      tx.delete(vaultItems).where(and(eq(vaultItems.id, itemId), eq(vaultItems.userId, actor.userId))).run()
    })
  }

  /** Irreversibly wipes the vault (used when both the master password and recovery key are lost). */
  async reset(actor: Actor) {
    this.guard(actor)
    this.deps.db.transaction((tx) => {
      tx.delete(vaultItems).where(eq(vaultItems.userId, actor.userId)).run()
      tx.update(vaults)
        .set({ kdf: null, wrappedKey: null, recoveryWrappedKey: null, updatedAt: new Date() })
        .where(eq(vaults.userId, actor.userId))
        .run()
    })
  }
}
