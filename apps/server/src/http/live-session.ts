import type { Actor } from '../auth/actor'
import type { Env } from '../env'
import type { Services } from '../services'
import { allowedOrigins } from './security'

/** `GET /api/workspaces/:id/live` (WebSocket). */
export const LIVE_PATH = /^\/api\/workspaces\/([0-9a-f-]{36})\/live$/i

export function readCookie(header: string | null | undefined, name: string) {
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at > 0 && part.slice(0, at).trim() === name) {
      try {
        return decodeURIComponent(part.slice(at + 1).trim())
      } catch {
        return null
      }
    }
  }
  return null
}

/**
 * WebSocket handshakes are not covered by CORS: only the app's own origins may
 * open a live connection, so other sites cannot listen in with the user's cookie.
 */
export const isAllowedOrigin = (env: Env, requestUrl: string, origin: string | null | undefined) =>
  Boolean(origin && allowedOrigins(env, requestUrl).includes(origin))

/** Checks the session cookie and the workspace membership, at connection time and on every ping. */
export async function authorizeLive(services: Services, token: string | null, workspaceId: string): Promise<401 | 404 | Actor> {
  if (!token) return 401
  // Never extends the session here: only an HTTP response can renew the cookie.
  const session = await services.accounts.authenticate(token, { refresh: false })
  if (!session) return 401
  try {
    await services.access.workspace(session.actor, workspaceId)
  } catch {
    return 404
  }
  return session.actor
}
