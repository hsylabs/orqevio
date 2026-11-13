import type { VaultItemRecordDTO, VaultStateDTO } from '@orqevio/shared'
import { MAX_VAULT_ITEMS, vaultItemInput, vaultKeysInput, vaultSettingsInput } from '@orqevio/shared'
import { and, asc, eq, isNotNull } from 'drizzle-orm'
import type { Actor } from '../auth/actor'
import { vaultItems, vaults } from '../db/schema'
import { conflict, forbidden, notFound } from '../lib/errors'
import { parse } from '../lib/validate'
import type { Access } from './access'
import type { Deps } from './deps'

/**
 * The vault stores opaque, client-side encrypted envelopes. The server has no
 * key material and cannot decrypt anything. Every method requires a browser
 * session: agent tokens are rejected before any vault data is read.
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
    }
  }

  async setup(actor: Actor, input: unknown) {
    this.guard(actor)
    const keys = parse(vaultKeysInput, input)
    const [existing] = await this.deps.db
      .select({ userId: vaults.userId })
      .from(vaults)
      .where(and(eq(vaults.userId, actor.userId), isNotNull(vaults.wrappedKey)))
    if (existing) throw conflict('The vault is already set up')
    await this.deps.db
      .insert(vaults)
      .values({ userId: actor.userId, ...keys })
      .onConflictDoUpdate({ target: vaults.userId, set: { ...keys, updatedAt: new Date() } })
  }

  /** Re-wraps the vault key (new master password or recovery). Item ciphertexts are untouched. */
  async rekey(actor: Actor, input: unknown) {
    this.guard(actor)
    const keys = parse(vaultKeysInput, input)
    const [row] = await this.deps.db
      .update(vaults)
      .set({ ...keys, updatedAt: new Date() })
      .where(and(eq(vaults.userId, actor.userId), isNotNull(vaults.wrappedKey)))
      .returning({ userId: vaults.userId })
    if (!row) throw notFound('Vault')
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

  async putItem(actor: Actor, itemId: string, input: unknown): Promise<VaultItemRecordDTO> {
    this.guard(actor)
    const { data } = parse(vaultItemInput, input)
    const state = await this.state(actor)
    if (!state.initialized) throw conflict('Set up the vault first')
    const [owner] = await this.deps.db.select({ userId: vaultItems.userId }).from(vaultItems).where(eq(vaultItems.id, itemId))
    if (owner && owner.userId !== actor.userId) throw notFound('Item')
    if (!owner) {
      const count = await this.deps.db.$count(vaultItems, eq(vaultItems.userId, actor.userId))
      if (count >= MAX_VAULT_ITEMS) throw conflict(`The vault is limited to ${MAX_VAULT_ITEMS} items`)
    }
    const now = new Date()
    const [row] = await this.deps.db
      .insert(vaultItems)
      .values({ id: itemId, userId: actor.userId, data })
      .onConflictDoUpdate({ target: vaultItems.id, set: { data, updatedAt: now }, where: eq(vaultItems.userId, actor.userId) })
      .returning()
    return { id: row!.id, data: row!.data, createdAt: row!.createdAt.toISOString(), updatedAt: row!.updatedAt.toISOString() }
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
