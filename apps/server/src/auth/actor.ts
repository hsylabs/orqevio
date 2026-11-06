import type { ActorRef, Scope } from '@orqevio/shared'

export interface UserActor {
  kind: 'user'
  userId: string
  name: string
  sessionId: string
}

export interface AgentActor {
  kind: 'agent'
  userId: string
  tokenId: string
  name: string
  /** Agent tokens are bound to exactly one workspace. */
  workspaceId: string
  scopes: ReadonlySet<Scope>
}

export type Actor = UserActor | AgentActor

export function actorRef(actor: Actor): ActorRef {
  return actor.kind === 'user'
    ? { kind: 'user', id: actor.userId, name: actor.name }
    : { kind: 'agent', id: actor.tokenId, name: actor.name }
}

export function hasScope(actor: Actor, scope: Scope) {
  return actor.kind === 'user' || actor.scopes.has(scope)
}
