import type { MeDTO, Theme, UserDTO } from '@orqevio/shared'
import { changePasswordInput, confirmPasswordInput, loginInput, registerInput, updateAccountInput } from '@orqevio/shared'
import { and, eq, gt, ne } from 'drizzle-orm'
import type { Actor, UserActor } from '../auth/actor'
import { burnPasswordCheck, hashPassword, randomToken, sha256, verifyPassword } from '../auth/crypto'
import { sessions, users, workspaceMembers, workspaces } from '../db/schema'
import { AppError, conflict, forbidden, unauthorized } from '../lib/errors'
import { parse } from '../lib/validate'
import type { Access } from './access'
import type { Deps } from './deps'
import type { WorkspaceService } from './workspaces'

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_REFRESH_MS = 24 * 60 * 60 * 1000

const toUserDTO = (u: typeof users.$inferSelect): UserDTO => ({
  id: u.id,
  email: u.email,
  name: u.name,
  theme: u.theme as Theme,
  createdAt: u.createdAt.toISOString(),
})

export class AccountService {
  constructor(
    private readonly deps: Deps,
    private readonly access: Access,
    private readonly workspaces: WorkspaceService,
  ) {}

  async register(input: unknown, userAgent: string | null) {
    const data = parse(registerInput, input)
    const passwordHash = await hashPassword(data.password)
    const firstName = data.name.split(/\s+/)[0] ?? data.name
    const user = await this.deps.db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, data.email))
      if (existing) throw conflict('An account with this email already exists')
      const [u] = await tx.insert(users).values({ email: data.email, name: data.name, passwordHash }).returning()
      const [w] = await tx.insert(workspaces).values({ name: `Espacio de ${firstName}`.slice(0, 60) }).returning()
      await tx.insert(workspaceMembers).values({ workspaceId: w!.id, userId: u!.id, role: 'owner' })
      return u!
    })
    return { user: toUserDTO(user), session: await this.createSession(user.id, userAgent) }
  }

  async login(input: unknown, userAgent: string | null) {
    const { email, password } = parse(loginInput, input)
    const [user] = await this.deps.db.select().from(users).where(eq(users.email, email))
    if (!user) {
      await burnPasswordCheck(password)
      throw new AppError(401, 'invalid_credentials', 'Incorrect email or password')
    }
    if (!(await verifyPassword(user.passwordHash, password))) {
      throw new AppError(401, 'invalid_credentials', 'Incorrect email or password')
    }
    return { user: toUserDTO(user), session: await this.createSession(user.id, userAgent) }
  }

  private async createSession(userId: string, userAgent: string | null) {
    const token = randomToken(32)
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
    await this.deps.db.insert(sessions).values({ id: sha256(token), userId, userAgent: userAgent?.slice(0, 300) ?? null, expiresAt })
    return { token, expiresAt }
  }

  /** Validates a session cookie, sliding its expiry at most once a day. */
  async authenticate(token: string): Promise<{ actor: UserActor; refreshed: Date | null } | null> {
    if (token.length < 20 || token.length > 100) return null
    const now = new Date()
    const [row] = await this.deps.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, now)))
    if (!row) return null
    let refreshed: Date | null = null
    if (now.getTime() - row.session.lastSeenAt.getTime() > SESSION_REFRESH_MS) {
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
    return { user: toUserDTO(user), workspaces: await this.workspaces.list(actor) }
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

  /** Changes the login password and signs out every other session. */
  async changePassword(actor: Actor, input: unknown) {
    this.access.requireUser(actor)
    const { currentPassword, newPassword } = parse(changePasswordInput, input)
    await this.verify(actor.userId, currentPassword)
    await this.deps.db.update(users).set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() }).where(eq(users.id, actor.userId))
    await this.deps.db.delete(sessions).where(and(eq(sessions.userId, actor.userId), ne(sessions.id, actor.sessionId)))
  }

  /** Deletes the account and every workspace it solely owns. */
  async remove(actor: Actor, input: unknown) {
    this.access.requireUser(actor)
    const { password } = parse(confirmPasswordInput, input)
    await this.verify(actor.userId, password)
    const owned = await this.deps.db
      .select({ id: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.userId, actor.userId), eq(workspaceMembers.role, 'owner')))
    await this.deps.db.transaction(async (tx) => {
      for (const w of owned) await tx.delete(workspaces).where(eq(workspaces.id, w.id))
      await tx.delete(users).where(eq(users.id, actor.userId))
    })
    for (const w of owned) await this.deps.storage.deleteWorkspace(w.id)
  }

  async verify(userId: string, password: string) {
    const [user] = await this.deps.db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId))
    if (!user || !(await verifyPassword(user.hash, password))) throw forbidden('Incorrect password', 'invalid_password')
  }
}
