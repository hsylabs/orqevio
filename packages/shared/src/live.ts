import type { RealtimeEvent } from './types'

/**
 * Live updates protocol (`GET /api/workspaces/:id/live`, WebSocket).
 * Server → client: JSON `LiveMessage`, or the text "pong" in reply to "ping".
 * Client → server: the text "ping", sent periodically to keep the connection
 * alive and to re-check the session.
 */
export type LiveMessage = { type: 'ready' } | { type: 'change'; event: RealtimeEvent }

/** Close codes used when the server ends a live connection on purpose. */
export const LIVE_CLOSE = {
  /** The session expired, was signed out or the access key was replaced. */
  sessionEnded: 4401,
  /** The user no longer has access to the workspace. */
  noAccess: 4403,
} as const
