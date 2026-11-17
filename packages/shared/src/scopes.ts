/**
 * Permission scopes for agent tokens. The web session implicitly holds all of
 * them. The password vault is intentionally NOT represented here: no token can
 * ever be granted access to it.
 */
export const SCOPES = ['tasks:read', 'tasks:write', 'docs:read', 'docs:write', 'organize'] as const
export type Scope = (typeof SCOPES)[number]

/**
 * `organize`: delete what the token can write (always to the trash), and move cards to another
 * board and attachments to another card or page. Tokens made before it don't have it.
 */
export const ORGANIZE: Scope = 'organize'

export type AccessLevel = 'none' | 'read' | 'write'

export function scopesFromLevels(levels: { tasks: AccessLevel; docs: AccessLevel; organize?: boolean }): Scope[] {
  const scopes: Scope[] = []
  if (levels.tasks !== 'none') scopes.push('tasks:read')
  if (levels.tasks === 'write') scopes.push('tasks:write')
  if (levels.docs !== 'none') scopes.push('docs:read')
  if (levels.docs === 'write') scopes.push('docs:write')
  // Deleting and moving only mean something with write access.
  if (levels.organize && (levels.tasks === 'write' || levels.docs === 'write')) scopes.push('organize')
  return scopes
}

export function levelFromScopes(scopes: readonly string[], area: 'tasks' | 'docs'): AccessLevel {
  if (scopes.includes(`${area}:write`)) return 'write'
  if (scopes.includes(`${area}:read`)) return 'read'
  return 'none'
}
