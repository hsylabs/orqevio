import type { CreatedTokenDTO, Scope, TokenDTO } from '@orqevio/shared'
import { SCOPES, tokenCreateInput } from '@orqevio/shared'
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm'
import type { Actor, AgentActor } from '../auth/actor'
import { randomToken, sha256 } from '../auth/crypto'
import { apiTokens, workspaceMembers, workspaces } from '../db/schema'
import { notFound } from '../lib/errors'
import { parse } from '../lib/validate'
import type { Access } from './access'
import type { Deps } from './deps'

export const TOKEN_PREFIX = 'orq_'

const toTokenDTO = (t: typeof apiTokens.$inferSelect, workspaceName: string): TokenDTO => ({
  id: t.id,
  name: t.name,
  workspaceId: t.workspaceId,
  workspaceName,
  prefix: t.prefix,
  scopes: t.scopes.filter((s): s is Scope => (SCOPES as readonly string[]).includes(s)),
  createdAt: t.createdAt.toISOString(),
  lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
  expiresAt: t.expiresAt?.toISOString() ?? null,
  revokedAt: t.revokedAt?.toISOString() ?? null,
})

export class TokenService {
  private readonly lastTouched = new Map<string, number>()

  constructor(
    private readonly deps: Deps,
    private readonly access: Access,
  ) {}

  async list(actor: Actor): Promise<TokenDTO[]> {
    this.access.requireUser(actor)
    const rows = await this.deps.db
      .select({ token: apiTokens, workspaceName: workspaces.name })
      .from(apiTokens)
      .innerJoin(workspaces, eq(workspaces.id, apiTokens.workspaceId))
      .where(eq(apiTokens.userId, actor.userId))
      .orderBy(desc(apiTokens.createdAt))
    return rows.map((r) => toTokenDTO(r.token, r.workspaceName))
  }

  async create(actor: Actor, input: unknown): Promise<CreatedTokenDTO> {
    this.access.requireUser(actor)
    const data = parse(tokenCreateInput, input)
    await this.access.workspace(actor, data.workspaceId)
    const token = `${TOKEN_PREFIX}${randomToken(32)}`
    const scopes = [...new Set(data.scopes)]
    // Write access implies read access on the same area.
    if (scopes.includes('tasks:write') && !scopes.includes('tasks:read')) scopes.push('tasks:read')
    if (scopes.includes('docs:write') && !scopes.includes('docs:read')) scopes.push('docs:read')
    const [row] = await this.deps.db
      .insert(apiTokens)
      .values({
        userId: actor.userId,
        workspaceId: data.workspaceId,
        name: data.name,
        tokenHash: sha256(token),
        prefix: token.slice(0, 12),
        scopes,
        expiresAt: data.expiresInDays ? new Date(Date.now() + data.expiresInDays * 86_400_000) : null,
      })
      .returning()
    const [w] = await this.deps.db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, data.workspaceId))
    return { ...toTokenDTO(row!, w!.name), token }
  }

  async revoke(actor: Actor, tokenId: string) {
    this.access.requireUser(actor)
    const [row] = await this.deps.db
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, actor.userId), isNull(apiTokens.revokedAt)))
      .returning({ id: apiTokens.id })
    if (!row) throw notFound('Token')
  }

  /** Resolves a bearer token into an agent actor, or null if invalid, expired, revoked or orphaned. */
  async authenticate(token: string): Promise<AgentActor | null> {
    if (!token.startsWith(TOKEN_PREFIX) || token.length > 100) return null
    const now = new Date()
    const [row] = await this.deps.db
      .select({ token: apiTokens })
      .from(apiTokens)
      .innerJoin(
        workspaceMembers,
        and(eq(workspaceMembers.workspaceId, apiTokens.workspaceId), eq(workspaceMembers.userId, apiTokens.userId)),
      )
      .where(
        and(
          eq(apiTokens.tokenHash, sha256(token)),
          isNull(apiTokens.revokedAt),
          or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
        ),
      )
      .limit(1)
    if (!row) return null
    const t = row.token
    // Throttle last-used writes to one per minute per token.
    const last = this.lastTouched.get(t.id) ?? 0
    if (now.getTime() - last > 60_000) {
      this.lastTouched.set(t.id, now.getTime())
      await this.deps.db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, t.id))
    }
    return {
      kind: 'agent',
      userId: t.userId,
      tokenId: t.id,
      name: t.name,
      workspaceId: t.workspaceId,
      scopes: new Set(t.scopes.filter((s): s is Scope => (SCOPES as readonly string[]).includes(s))),
    }
  }
}
