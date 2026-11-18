import type { VaultItemRecordDTO, VaultStateDTO } from '@orqevio/shared'
import { MAX_VAULT_ITEMS, vaultItemInput, vaultKeysInput, vaultRekeyInput, vaultSettingsInput } from '@orqevio/shared'
import { and, asc, count, eq, isNotNull } from 'drizzle-orm'
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

  /** A new vault key: its version is one more than the last one this person's vault had. */
  async setup(actor: Actor, input: unknown) {
    this.guard(actor)
    const keys = parse(vaultKeysInput, input)
    this.deps.db.transaction((tx) => {
      const existing = tx.select({ wrappedKey: vaults.wrappedKey, keyVersion: vaults.keyVersion }).from(vaults).where(eq(vaults.userId, actor.userId)).get()
      if (existing?.wrappedKey) throw conflict('The vault is already set up')
      const keyVersion = (existing?.keyVersion ?? 0) + 1
      tx.insert(vaults)
        .values({ userId: actor.userId, ...keys, keyVersion })
        .onConflictDoUpdate({ target: vaults.userId, set: { ...keys, keyVersion, updatedAt: new Date() } })
        .run()
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
      const vault = tx.select({ keyVersion: vaults.keyVersion }).from(vaults).where(and(eq(vaults.userId, actor.userId), isNotNull(vaults.wrappedKey))).get()
      if (!vault) throw notFound('Vault')
      if (vault.keyVersion !== keyVersion) throw keyChanged()
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
    const { data, keyVersion } = parse(vaultItemInput, input)
    const row = this.deps.db.transaction((tx) => {
      const vault = tx.select({ wrappedKey: vaults.wrappedKey, keyVersion: vaults.keyVersion }).from(vaults).where(eq(vaults.userId, actor.userId)).get()
      if (!vault?.wrappedKey) throw conflict('Set up the vault first')
      if (vault.keyVersion !== keyVersion) throw keyChanged()
      const owner = tx.select({ userId: vaultItems.userId }).from(vaultItems).where(eq(vaultItems.id, itemId)).get()
      if (owner && owner.userId !== actor.userId) throw notFound('Item')
      if (!owner) {
        const stored = tx.select({ n: count() }).from(vaultItems).where(eq(vaultItems.userId, actor.userId)).get()
        if ((stored?.n ?? 0) >= MAX_VAULT_ITEMS) throw conflict(`The vault is limited to ${MAX_VAULT_ITEMS} items`)
      }
      return tx
        .insert(vaultItems)
        .values({ id: itemId, userId: actor.userId, data, keyVersion })
        .onConflictDoUpdate({ target: vaultItems.id, set: { data, keyVersion, updatedAt: new Date() }, where: eq(vaultItems.userId, actor.userId) })
        .returning()
        .get()
    })
    return { id: row.id, data: row.data, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
  }

  async deleteItem(actor: Actor, itemId: string) {
    this.guard(actor)
    const [row] = await this.deps.db
      .delete(vaultItems)
      .where(and(eq(vaultItems.id, itemId), eq(vaultItems.userId, actor.userId)))
      .returning({ id: vaultItems.id })
    if (!row) throw notFound('Item')
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
