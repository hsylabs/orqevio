import type { AccessStateDTO, MeDTO, Theme, UserDTO } from '@orqevio/shared'
import { DEFAULT_LOCALE, defaultWorkspaceName, isLocale } from '@orqevio/shared'
import { claimInput, confirmAccessKeyInput, recoverInput, rotateAccessKeyInput, unlockInput, updateAccountInput } from '@orqevio/shared'
import { and, asc, eq, gt, ne } from 'drizzle-orm'
import type { Actor, UserActor } from '../auth/actor'
import { generateAccessKey, generateSetupCode, randomToken, safeEqual, secretFingerprint, sha256 } from '../auth/crypto'
import { instance, sessions, users, workspaceMembers, workspaces } from '../db/schema'
import { AppError, forbidden, unauthorized } from '../lib/errors'
import { parse } from '../lib/validate'
import type { Access } from './access'
import type { Deps } from './deps'
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

const invalidSetupCode = () => forbidden('The setup code is not valid', 'invalid_setup_code')
const invalidAccessKey = () => forbidden('The access key is not valid', 'invalid_access_key')

/**
 * Access to a copy of Orqevio. There is no registration: the copy is claimed
 * once with the setup code chosen at install time, which creates its owner and
 * returns a random access key. The owner signs in with that key on each device.
 */
export class AccountService {
  /** Generated when the operator did not set SETUP_CODE; lives only in memory. */
  private generatedSetupCode: string | null = null

  constructor(
    private readonly deps: Deps,
    private readonly access: Access,
    private readonly workspaces: WorkspaceService,
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
    const row = await this.instanceRow()
    return { claimed: Boolean(row), recoverable: this.isRecoverable(row) }
  }

  /**
   * What to print at startup while the copy is unclaimed: the generated code, or
   * null when the operator configured SETUP_CODE. Undefined once claimed.
   */
  async setupNotice(): Promise<{ generatedCode: string | null } | undefined> {
    if (await this.instanceRow()) return undefined
    return { generatedCode: this.deps.env.setupCode ? null : this.currentSetupCode() }
  }

  async claim(input: unknown, userAgent: string | null) {
    // The language the claim screen was shown in becomes the owner's.
    const { setupCode, name, locale = DEFAULT_LOCALE } = parse(claimInput, input)
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
        const w = tx.insert(workspaces).values({ name: defaultWorkspaceName(locale, firstName).slice(0, 60) }).returning().get()
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
   * it here. Issues a new access key and signs out every session.
   */
  async recover(input: unknown, userAgent: string | null) {
    const { setupCode } = parse(recoverInput, input)
    const row = await this.instanceRow()
    const configured = this.deps.env.setupCode
    if (!row || !configured || !this.isRecoverable(row)) throw invalidSetupCode()
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
      return true
    })
    if (!consumed) throw invalidSetupCode()
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
      for (const w of owned) tx.delete(workspaces).where(eq(workspaces.id, w.id)).run()
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
  async verifyAccessKey(userId: string, accessKey: string) {
    const row = await this.instanceRow()
    if (!row || row.ownerId !== userId || !safeEqual(secretFingerprint(accessKey), row.accessKeyHash)) throw invalidAccessKey()
    return row
  }
}
