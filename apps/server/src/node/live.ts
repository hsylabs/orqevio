import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { LIVE_CLOSE, type LiveMessage } from '@orqevio/shared'
import { type WebSocket, WebSocketServer } from 'ws'
import type { Env } from '../env'
import { LIVE_PATH, authorizeLive, isAllowedOrigin, readCookie } from '../http/live-session'
import { sessionCookieName } from '../http/middleware'
import type { RealtimeBus } from '../lib/realtime'
import type { Services } from '../services'

function reject(socket: Duplex, status: 401 | 403 | 404, text: string) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

/**
 * Live updates over WebSocket: `GET /api/workspaces/:id/live`.
 *
 * Only browsers with a session cookie connect, from one of the APP_URL origins
 * (WebSocket handshakes are not covered by CORS, so the Origin check is what
 * stops other sites from listening in). The client sends "ping" every few
 * seconds; each ping re-checks the session and the workspace membership, so a
 * signed-out or removed member stops receiving events.
 */
export function attachLiveUpdates(server: Server, env: Env, services: Services, bus: RealtimeBus) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 })
  const cookieName = sessionCookieName(env)
  const authorize = (token: string | null, workspaceId: string) => authorizeLive(services, token, workspaceId)

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let pathname: string
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    } catch {
      // Malformed request targets such as "//" must not take the server down.
      reject(socket, 404, 'Not Found')
      return
    }
    const match = LIVE_PATH.exec(pathname)
    if (!match) {
      reject(socket, 404, 'Not Found')
      return
    }
    if (!isAllowedOrigin(env, `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, req.headers.origin)) {
      reject(socket, 403, 'Forbidden')
      return
    }
    const workspaceId = match[1]!.toLowerCase()
    const token = readCookie(req.headers.cookie, cookieName)
    authorize(token, workspaceId)
      .then((result) => {
        if (result === 401) return reject(socket, 401, 'Unauthorized')
        if (result === 404) return reject(socket, 404, 'Not Found')
        wss.handleUpgrade(req, socket, head, (ws) => connect(ws, workspaceId, token!))
      })
      .catch((error) => {
        console.error('[live] upgrade failed', error)
        socket.destroy()
      })
  })

  function connect(ws: WebSocket, workspaceId: string, token: string) {
    const send = (message: LiveMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
    }
    const unsubscribe = bus.subscribe(workspaceId, (event) => send({ type: 'change', event }))
    send({ type: 'ready' })
    ws.on('message', (data) => {
      if (data.toString() !== 'ping') return
      authorize(token, workspaceId)
        .then((result) => {
          if (result === 401) ws.close(LIVE_CLOSE.sessionEnded, 'session_ended')
          else if (result === 404) ws.close(LIVE_CLOSE.noAccess, 'no_access')
          else if (ws.readyState === ws.OPEN) ws.send('pong')
        })
        .catch(() => ws.close(1011, 'error'))
    })
    ws.on('close', unsubscribe)
    ws.on('error', () => ws.terminate())
  }

  return wss
}
