import type { Scope } from '@orqevio/shared'
import { and, eq } from 'drizzle-orm'
import type { Actor } from '../auth/actor'
import { hasScope } from '../auth/actor'
import { workspaceMembers } from '../db/schema'
import { forbidden, notFound } from '../lib/errors'
import type { Deps } from './deps'

const SCOPE_LABEL: Record<Scope, string> = {
  'tasks:read': 'read tasks',
  'tasks:write': 'modify tasks',
  'docs:read': 'read documents',
  'docs:write': 'modify documents',
}

/** Central authorisation checks used by every service. */
export class Access {
  constructor(private readonly deps: Deps) {}

  requireScope(actor: Actor, scope: Scope) {
    if (!hasScope(actor, scope)) {
      throw forbidden(`This agent token is not allowed to ${SCOPE_LABEL[scope]} (missing "${scope}").`, 'missing_scope')
    }
  }

  requireAnyScope(actor: Actor, scopes: Scope[]) {
    if (!scopes.some((s) => hasScope(actor, s))) this.requireScope(actor, scopes[0]!)
  }

  requireUser(actor: Actor): asserts actor is Extract<Actor, { kind: 'user' }> {
    if (actor.kind !== 'user') throw forbidden('This action is only available from the Orqevio app.', 'session_required')
  }

  /** Throws 404 when the actor cannot reach the workspace. Returns the member role. */
  async workspace(actor: Actor, workspaceId: string): Promise<'owner' | 'editor'> {
    if (actor.kind === 'agent' && actor.workspaceId !== workspaceId) throw notFound('Workspace')
    const [member] = await this.deps.db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, actor.userId)))
      .limit(1)
    if (!member) throw notFound('Workspace')
    return member.role
  }
}
