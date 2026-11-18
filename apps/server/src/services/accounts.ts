import type { AccessStateDTO, MeDTO, Theme, UninstalledDTO, UserDTO } from '@orqevio/shared'
import { DEFAULT_LOCALE, clip, defaultWorkspaceName, isLocale } from '@orqevio/shared'
import { claimInput, confirmAccessKeyInput, installerUninstallInput, recoverInput, rotateAccessKeyInput, uninstallInput, unlockInput, updateAccountInput } from '@orqevio/shared'
import { and, asc, eq, gt, isNull, ne, sql } from 'drizzle-orm'
import type { Actor, UserActor } from '../auth/actor'
import { MIN_SETUP_CODE_LENGTH, generateAccessKey, generateSetupCode, isWeakSetupCode, randomToken, safeEqual, secretFingerprint, sha256 } from '../auth/crypto'
import * as schema from '../db/schema'
import { apiTokens, copyState, instance, oauthCodes, pages, sessions, users, workspaceMembers, workspaces } from '../db/schema'
import { AppError, forbidden, unauthorized, uninstalled as copyUninstalled } from '../lib/errors'
import { parse } from '../lib/validate'
import type { Access } from './access'
import type { Deps } from './deps'
import type { AttachmentService } from './attachments'
import { deletePageTrees } from './pages'
import type { WorkspaceService } from './workspaces'

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_REFRESH_MS = 24 * 60 * 60 * 1000

const toUserDTO = (u: typeof users.$inferSelect): UserDTO => ({
  id: u.id,
  name: u.name,
  theme: u.theme as Theme,
  locale: isLocale(u.locale) ? u.locale : DEFAULT_LOCALE,
  createdAt: u.createdAt.toISOString(),
})

/** Where the mark of an uninstalled copy is kept (copy_state), with when it happened. */
export const UNINSTALLED_KEY = 'uninstalled'
/** Whether the backups were kept when the copy was uninstalled ("kept" or "deleted"). */
const UNINSTALLED_BACKUPS_KEY = 'uninstalled_backups'
/** Every table of the copy, each after those that point at it. */
const UNINSTALL_ORDER = [
  schema.history,
  schema.trashRows,
  schema.trash,
  schema.cardLabels,
  schema.checklistItems,
  schema.checklists,
  schema.cardPageLinks,
  schema.attachments,
  schema.activity,
  schema.labels,
  schema.cards,
  schema.columns,
  schema.boards,
  schema.pages,
  schema.projects,
  schema.oauthTokens,
  schema.oauthCodes,
  schema.apiTokens,
  schema.sessions,
  schema.workspaceMembers,
  schema.vaultItems,
  schema.vaults,
  schema.workspaces,
  schema.instance,
  schema.users,
  schema.copyState,
]

const invalidSetupCode = () => forbidden('The setup code is not valid', 'invalid_setup_code')
/**
 * The copy still has the setup code that claimed it, or last recovered it: a new one is not set,
 * or has not reached the copy yet (Cloudflare can take a moment to deploy a new secret).
 */
const weakSetupCode = () =>
  new AppError(409, 'setup_code_too_short', `The setup code set for this copy has fewer than ${MIN_SETUP_CODE_LENGTH} letters A–Z or digits: set a longer one`)
const recoveryNotReady = () => new AppError(409, 'recovery_not_ready', 'This copy has no new setup code yet: set one, or wait for it to arrive')
const invalidAccessKey = () => forbidden('The access key is not valid', 'invalid_access_key')

/**
 * Access to a copy of Orqevio. There is no registration: the copy is claimed
 * once with the setup code chosen at install time, which creates its owner and
 * returns a random access key. The owner signs in with that key on each device.
 */
export class AccountService {
  /** Generated when the operator did not set SETUP_CODE; lives only in memory. */
  private generatedSetupCode: string | null = null
  /** The backups, which uninstalling waits for and may delete (set by createServices: they depend on this service). */
  private backups: { close(): Promise<void>; reopen(): void; deleteAll(): Promise<void> } | null = null

  useBackups(backups: { close(): Promise<void>; reopen(): void; deleteAll(): Promise<void> }) {
    this.backups = backups
  }

  /** Read once: uninstalling is final, so a copy found uninstalled stays so. */
  private uninstalledState: UninstalledDTO | null | undefined

  constructor(
    private readonly deps: Deps,
    private readonly access: Access,
    private readonly workspaces: WorkspaceService,
    private readonly attachments: AttachmentService,
  ) {}

  private currentSetupCode() {
    return this.deps.env.setupCode ?? (this.generatedSetupCode ??= generateSetupCode())
  }

  private async instanceRow() {
    const [row] = await this.deps.db.select().from(instance).where(eq(instance.id, 1))
    return row ?? null
  }

  /** True when the configured setup code differs from the one that claimed the copy. */
  private isRecoverable(row: typeof instance.$inferSelect | null) {
    const configured = this.deps.env.setupCode
    return Boolean(row && configured && secretFingerprint(configured) !== row.setupCodeHash)
  }

  async state(): Promise<AccessStateDTO> {
    const { install, copyName } = this.deps.env
    const uninstalled = await this.uninstalled()
    if (uninstalled) return { claimed: false, recoverable: false, install, copyName, uninstalled }
    const row = await this.instanceRow()
    return { claimed: Boolean(row), recoverable: this.isRecoverable(row), install, copyName }
  }

  /** Set once the copy was uninstalled from Settings; it then refuses everything but saying so. */
  async uninstalled(): Promise<UninstalledDTO | null> {
    if (this.uninstalledState !== undefined && this.uninstalledState !== null) return this.uninstalledState
    const [row] = await this.deps.db.select({ value: copyState.value }).from(copyState).where(eq(copyState.key, UNINSTALLED_KEY))
    const [backups] = row ? await this.deps.db.select({ value: copyState.value }).from(copyState).where(eq(copyState.key, UNINSTALLED_BACKUPS_KEY)) : []
    this.uninstalledState = row ? this.uninstalledDetails(row.value, backups?.value !== 'deleted') : null
    return this.uninstalledState
  }

  private uninstalledDetails(at: string, backupsKept: boolean): UninstalledDTO {
    const { install, copyName, copyBucket } = this.deps.env
    const where = this.deps.backups?.where
    return { at, install, copyName, bucket: copyBucket, backups: where ? { kept: backupsKept, where } : null }
  }

  /** Uninstalling from Settings, confirmed with the access key. */
  async uninstall(actor: Actor, input: unknown): Promise<UninstalledDTO> {
    this.access.requireUser(actor)
    const { accessKey, deleteBackups } = parse(uninstallInput, input)
    await this.verifyAccessKey(actor.userId, accessKey)
    return this.wipe(deleteBackups)
  }

  /**
   * Uninstalling asked by `npx create-orqevio uninstall`, from the person's computer. It proves
   * it controls the Cloudflare account this copy lives in by setting ORQEVIO_UNINSTALL_TOKEN on
   * its Worker first: a copy with the same name in another account never gets it, so an address
   * typed by mistake cannot erase it. The token expires on its own, should the uninstall stop.
   */
  async uninstallFromInstaller(input: unknown): Promise<UninstalledDTO> {
    const { token, deleteBackups } = parse(installerUninstallInput, input)
    const expected = this.deps.env.uninstallToken
    const expiresAt = Number(expected?.split('.')[0])
    if (!expected || !(expiresAt > Date.now()) || !safeEqual(sha256(token), sha256(expected))) {
      throw forbidden('The installer has not authorized this uninstall', 'uninstall_not_authorized')
    }
    return this.wipe(deleteBackups)
  }

  /**
   * Uninstalling, the part a copy can do itself: every attachment, then every row
   * (people, workspaces, documents, vault, agents, sessions) goes, and a mark stays
   * so the empty copy cannot be claimed again with its old setup code. Removing the
   * copy itself (the Worker and its bucket, or the container) is left to whoever
   * installed it, as the page shown afterwards explains.
   */
  private async wipe(deleteBackups: boolean): Promise<UninstalledDTO> {
    // Attachments first, once no upload is still writing one: if this stops half-way,
    // the data is still there, uploads open again and it can be retried.
    await this.attachments.close()
    // No backup starts now, and the one running finishes before anything is deleted.
    await this.backups?.close()
    const at = new Date().toISOString()
    try {
      // Kept apart from the data, the backups go only when the person says so.
      if (deleteBackups) await this.backups?.deleteAll()
      await this.deps.storage.deleteAll()
      this.deps.db.transaction((tx) => {
        // Every table, children first, without relying on cascades; search indexes follow by trigger.
        for (const table of UNINSTALL_ORDER) {
          if (table === schema.pages) deletePageTrees(tx, sql`${schema.pages.parentId} IS NULL`)
          else tx.delete(table).run()
        }
        tx.insert(copyState).values({ key: UNINSTALLED_KEY, value: at }).run()
        tx.insert(copyState).values({ key: UNINSTALLED_BACKUPS_KEY, value: deleteBackups ? 'deleted' : 'kept' }).run()
      })
    } catch (error) {
      this.attachments.reopen()
      this.backups?.reopen()
      throw error
    }
    this.uninstalledState = this.uninstalledDetails(at, !deleteBackups)
    this.generatedSetupCode = null
    return this.uninstalledState
  }

  /**
   * What to print at startup while the copy is unclaimed: the generated code, or
   * null when the operator configured SETUP_CODE. Undefined once claimed.
   */
  async setupNotice(): Promise<{ generatedCode: string | null } | undefined> {
    if ((await this.uninstalled()) || (await this.instanceRow())) return undefined
    return { generatedCode: this.deps.env.setupCode ? null : this.currentSetupCode() }
  }

  async claim(input: unknown, userAgent: string | null) {
    // The language the claim screen was shown in becomes the owner's.
    const { setupCode, name, locale = DEFAULT_LOCALE } = parse(claimInput, input)
    // Uninstalling is final, whatever route a request takes to get here.
    if (await this.uninstalled()) throw copyUninstalled()
    if (isWeakSetupCode(this.currentSetupCode())) throw weakSetupCode()
    const expected = secretFingerprint(this.currentSetupCode())
    if (!safeEqual(secretFingerprint(setupCode), expected)) throw invalidSetupCode()
    const accessKey = generateAccessKey()
    const user = this.deps.db.transaction((tx) => {
      // Users left without an owner (e.g. after an upgrade) are kept: the oldest one becomes the owner.
      const existing = tx.select().from(users).orderBy(asc(users.createdAt)).limit(1).get()
      let owner: typeof users.$inferSelect
      if (existing) {
        owner = tx.update(users).set({ name, locale, updatedAt: new Date() }).where(eq(users.id, existing.id)).returning().get()!
      } else {
        owner = tx.insert(users).values({ name, locale }).returning().get()
        const firstName = name.split(/\s+/)[0] ?? name
        const w = tx.insert(workspaces).values({ name: clip(defaultWorkspaceName(locale, firstName), 60) }).returning().get()
        tx.insert(workspaceMembers).values({ workspaceId: w.id, userId: owner.id, role: 'owner' }).run()
      }
      const claimed = tx
        .insert(instance)
        .values({ id: 1, ownerId: owner.id, accessKeyHash: secretFingerprint(accessKey), setupCodeHash: expected })
        .onConflictDoNothing()
        .returning({ id: instance.id })
        .all()
      if (claimed.length === 0) throw new AppError(409, 'already_claimed', 'This copy already has an owner')
      return owner
    })
    this.generatedSetupCode = null
    return { user: toUserDTO(user), accessKey, session: await this.createSession(user.id, userAgent) }
  }

  async login(input: unknown, userAgent: string | null) {
    const { accessKey } = parse(unlockInput, input)
    if (await this.uninstalled()) throw copyUninstalled()
    const row = await this.instanceRow()
    if (!row) throw new AppError(409, 'not_claimed', 'This copy has not been set up yet')
    if (!safeEqual(secretFingerprint(accessKey), row.accessKeyHash)) {
      throw new AppError(401, 'invalid_access_key', 'The access key is not valid')
    }
    const user = await this.owner(row.ownerId)
    return { user: toUserDTO(user), session: await this.createSession(user.id, userAgent) }
  }

  /**
   * Lost key: whoever controls the installation sets a new SETUP_CODE and enters
   * it here. Issues a new access key and signs out every session. When the key may
   * be in someone else's hands, every agent loses its access too: tokens, OAuth
   * accesses and authorization codes not yet exchanged.
   */
  async recover(input: unknown, userAgent: string | null) {
    const { setupCode, reason } = parse(recoverInput, input)
    if (await this.uninstalled()) throw copyUninstalled()
    const row = await this.instanceRow()
    const configured = this.deps.env.setupCode
    if (!row) throw invalidSetupCode()
    if (!configured || !this.isRecoverable(row)) throw recoveryNotReady()
    if (isWeakSetupCode(configured)) throw weakSetupCode()
    if (!safeEqual(secretFingerprint(setupCode), secretFingerprint(configured))) throw invalidSetupCode()
    const accessKey = generateAccessKey()
    // The new setup code is consumed atomically: of two concurrent recoveries, only the first one wins.
    const consumed = this.deps.db.transaction((tx) => {
      const updated = tx
        .update(instance)
        .set({ accessKeyHash: secretFingerprint(accessKey), setupCodeHash: secretFingerprint(configured), keyChangedAt: new Date() })
        .where(and(eq(instance.id, 1), eq(instance.setupCodeHash, row.setupCodeHash)))
        .returning({ id: instance.id })
        .all()
      if (updated.length === 0) return false
      tx.delete(sessions).where(eq(sessions.userId, row.ownerId)).run()
      if (reason === 'compromised') revokeAgents(tx, row.ownerId)
      return true
    })
    // The other recovery used this code first.
    if (!consumed) throw recoveryNotReady()
    const user = await this.owner(row.ownerId)
    return { user: toUserDTO(user), accessKey, session: await this.createSession(user.id, userAgent) }
  }

  /** Replaces the access key from Settings; other sessions are signed out. */
  async rotateAccessKey(actor: Actor, input: unknown) {
    this.access.requireUser(actor)
    const { currentAccessKey } = parse(rotateAccessKeyInput, input)
    const row = await this.verifyAccessKey(actor.userId, currentAccessKey)
    const accessKey = await this.replaceKey(row.ownerId, actor.sessionId)
    return { accessKey }
  }

  /** Administration CLI: new access key, every session signed out. */
  async resetAccess() {
    const row = await this.instanceRow()
    if (!row) return null
    return this.replaceKey(row.ownerId)
  }

  private async replaceKey(ownerId: string, keepSessionId?: string) {
    const accessKey = generateAccessKey()
    this.deps.db.transaction((tx) => {
      tx.update(instance).set({ accessKeyHash: secretFingerprint(accessKey), keyChangedAt: new Date() }).where(eq(instance.id, 1)).run()
      tx.delete(sessions)
        .where(keepSessionId ? and(eq(sessions.userId, ownerId), ne(sessions.id, keepSessionId)) : eq(sessions.userId, ownerId))
        .run()
    })
    return accessKey
  }

  private async owner(ownerId: string) {
    const [user] = await this.deps.db.select().from(users).where(eq(users.id, ownerId))
    if (!user) throw unauthorized()
    return user
  }

  /** Forgets what it read of the copy, after a restore replaced the database under it. */
  forget() {
    this.uninstalledState = undefined
    this.generatedSetupCode = null
  }

  /** A new session for the owner, for whoever just restored a backup (which ended every other one). */
  startSession(userId: string, userAgent: string | null) {
    return this.createSession(userId, userAgent)
  }

  private async createSession(userId: string, userAgent: string | null) {
    const token = randomToken(32)
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
    await this.deps.db.insert(sessions).values({ id: sha256(token), userId, userAgent: userAgent?.slice(0, 300) ?? null, expiresAt })
    return { token, expiresAt }
  }

  /** Validates a session cookie, sliding its expiry at most once a day. */
  /**
   * Resolves a session token. Once a day it also extends the session, which the
   * caller must pass on to the browser cookie; callers that cannot set a cookie
   * (the live connection) pass `refresh: false` and leave that to the next request.
   */
  async authenticate(token: string, { refresh = true } = {}): Promise<{ actor: UserActor; refreshed: Date | null } | null> {
    if (token.length < 20 || token.length > 100) return null
    const now = new Date()
    const [row] = await this.deps.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, now)))
    if (!row) return null
    let refreshed: Date | null = null
    if (refresh && now.getTime() - row.session.lastSeenAt.getTime() > SESSION_REFRESH_MS) {
      refreshed = new Date(now.getTime() + SESSION_TTL_MS)
      await this.deps.db.update(sessions).set({ lastSeenAt: now, expiresAt: refreshed }).where(eq(sessions.id, row.session.id))
    }
    return { actor: { kind: 'user', userId: row.user.id, name: row.user.name, sessionId: row.session.id }, refreshed }
  }

  async logout(actor: Actor) {
    if (actor.kind === 'user') await this.deps.db.delete(sessions).where(eq(sessions.id, actor.sessionId))
  }

  async me(actor: Actor): Promise<MeDTO> {
    this.access.requireUser(actor)
    const [user] = await this.deps.db.select().from(users).where(eq(users.id, actor.userId))
    if (!user) throw unauthorized()
    return { user: toUserDTO(user), workspaces: await this.workspaces.list(actor), limits: { maxUploadBytes: this.deps.env.maxUploadBytes } }
  }

  async update(actor: Actor, input: unknown): Promise<UserDTO> {
    this.access.requireUser(actor)
    const data = parse(updateAccountInput, input)
    const [user] = await this.deps.db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, actor.userId))
      .returning()
    return toUserDTO(user!)
  }

  /**
   * Deletes the owner with every workspace it solely owns. The copy becomes
   * unclaimed and asks for the setup code again.
   */
  async remove(actor: Actor, input: unknown) {
    this.access.requireUser(actor)
    const { accessKey } = parse(confirmAccessKeyInput, input)
    await this.verifyAccessKey(actor.userId, accessKey)
    const owned = await this.deps.db
      .select({ id: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.userId, actor.userId), eq(workspaceMembers.role, 'owner')))
    this.deps.db.transaction((tx) => {
      for (const w of owned) {
        deletePageTrees(tx, sql`${pages.workspaceId} = ${w.id} AND ${pages.parentId} IS NULL`)
        tx.delete(workspaces).where(eq(workspaces.id, w.id)).run()
      }
      tx.delete(users).where(eq(users.id, actor.userId)).run()
    })
    for (const w of owned) await this.deps.storage.deleteWorkspace(w.id)
    // Without SETUP_CODE, the copy needs a fresh one-off code to be claimed again; it is only shown in the server log.
    if (!this.deps.env.setupCode) {
      this.generatedSetupCode = generateSetupCode()
      console.log(`This copy is not claimed anymore. Setup code: ${this.generatedSetupCode} (valid until the copy is claimed or the server restarts)`)
    }
  }

  /** Confirms a sensitive action with the access key; only the owner has one. */
  /** Only the person who owns the copy: backups, for instance, hold everything in it. */
  async requireOwner(actor: Actor) {
    this.access.requireUser(actor)
    const row = await this.instanceRow()
    if (!row || row.ownerId !== actor.userId) throw forbidden('Only the owner of this copy can do this')
  }

  async verifyAccessKey(userId: string, accessKey: string) {
    const row = await this.instanceRow()
    if (!row || row.ownerId !== userId || !safeEqual(secretFingerprint(accessKey), row.accessKeyHash)) throw invalidAccessKey()
    return row
  }
}

/**
 * Takes away every agent's access, OAuth included: whoever held the access key
 * may have connected one of their own. Codes not exchanged yet go too, so none
 * turns into a new access afterwards.
 */
export function revokeAgents(tx: Pick<Deps['db'], 'update' | 'delete'>, userId: string) {
  tx.update(apiTokens).set({ revokedAt: new Date() }).where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt))).run()
  tx.delete(oauthCodes).where(and(eq(oauthCodes.userId, userId), isNull(oauthCodes.usedAt))).run()
}
