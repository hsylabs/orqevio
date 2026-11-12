import { LIVE_CLOSE, type LiveMessage, type RealtimeEvent } from '@orqevio/shared'
import { useEffect, useSyncExternalStore } from 'react'
import { keys, queryClient } from './queries'

/** Ids of cards/pages recently touched by an agent, for the live "agent glow". */
const highlights = new Map<string, { name: string; until: number }>()
const listeners = new Set<() => void>()
let snapshot = 0
let lastAgentActivity = 0

function notify() {
  snapshot++
  for (const l of listeners) l()
}

function highlight(id: string, name: string) {
  highlights.set(id, { name, until: Date.now() + 4500 })
  lastAgentActivity = Date.now()
  notify()
  setTimeout(() => {
    const h = highlights.get(id)
    if (h && h.until <= Date.now()) {
      highlights.delete(id)
      notify()
    }
  }, 4600)
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function useAgentHighlight(id: string): string | null {
  useSyncExternalStore(subscribe, () => snapshot)
  const h = highlights.get(id)
  return h && h.until > Date.now() ? h.name : null
}

/** True while an agent has acted in the last few seconds. */
export function useAgentLive(): boolean {
  useSyncExternalStore(subscribe, () => snapshot)
  return Date.now() - lastAgentActivity < 6000
}

type PageListener = (event: RealtimeEvent) => void
const pageListeners = new Set<PageListener>()
export function onPageEvent(fn: PageListener) {
  pageListeners.add(fn)
  return () => {
    pageListeners.delete(fn)
  }
}

type AgentToast = (event: RealtimeEvent) => void
let agentToast: AgentToast | null = null
export const setAgentToast = (fn: AgentToast | null) => {
  agentToast = fn
}

function handle(workspaceId: string, event: RealtimeEvent, selfId: string | undefined) {
  const fromSelf = event.actor.kind === 'user' && event.actor.id === selfId
  if (event.boardId) {
    void queryClient.invalidateQueries({ queryKey: keys.board(event.boardId) })
    void queryClient.invalidateQueries({ queryKey: keys.archived(event.boardId) })
  }
  if (event.cardId) void queryClient.invalidateQueries({ queryKey: keys.card(event.cardId) })
  if (event.pageId) {
    for (const l of pageListeners) l(event)
    if (event.cardId) void queryClient.invalidateQueries({ queryKey: keys.page(event.pageId) })
  }
  if (event.structure) void queryClient.invalidateQueries({ queryKey: keys.overview(workspaceId) })
  void queryClient.invalidateQueries({ queryKey: keys.home(workspaceId) })
  void queryClient.invalidateQueries({ queryKey: ['activity', workspaceId] })
  if (event.actor.kind === 'agent') {
    if (event.cardId) highlight(event.cardId, event.actor.name)
    if (event.pageId) highlight(event.pageId, event.actor.name)
    agentToast?.(event)
  }
  return fromSelf
}

const PING_EVERY_MS = 25_000
const PONG_TIMEOUT_MS = 10_000

/**
 * Keeps one WebSocket per open workspace. It pings the server periodically (which
 * also re-checks the session), reconnects with backoff, and refetches everything
 * after a reconnection in case events were missed meanwhile.
 */
export function useRealtime(workspaceId: string | undefined, selfId: string | undefined) {
  useEffect(() => {
    // Wait for the user too: opening before it is known would mean reconnecting right away.
    if (!workspaceId || !selfId) return
    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let ping: ReturnType<typeof setInterval> | undefined
    let pongDeadline: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    let closed = false

    const stopTimers = () => {
      clearInterval(ping)
      clearTimeout(pongDeadline)
    }
    const open = () => {
      const url = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/workspaces/${workspaceId}/live`
      const ws = new WebSocket(url)
      socket = ws
      ws.onmessage = (msg) => {
        if (msg.data === 'pong') {
          clearTimeout(pongDeadline)
          return
        }
        try {
          const data = JSON.parse(String(msg.data)) as LiveMessage
          if (data.type === 'ready') {
            if (attempts > 0) void queryClient.invalidateQueries()
            attempts = 0
          } else if (data.type === 'change') {
            handle(workspaceId, data.event, selfId)
          }
        } catch (error) {
          console.error('Invalid realtime message', error)
        }
      }
      ws.onopen = () => {
        ping = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return
          ws.send('ping')
          clearTimeout(pongDeadline)
          // No answer: the connection is dead even if the browser has not noticed yet.
          pongDeadline = setTimeout(() => ws.close(), PONG_TIMEOUT_MS)
        }, PING_EVERY_MS)
      }
      ws.onclose = (event) => {
        stopTimers()
        if (closed) return
        if (event.code === LIVE_CLOSE.sessionEnded || event.code === LIVE_CLOSE.noAccess) {
          // Let the app react (sign-in screen or "not found") instead of retrying blindly.
          void queryClient.invalidateQueries({ queryKey: keys.me })
        }
        attempts++
        retry = setTimeout(open, Math.min(1000 * 2 ** attempts, 20_000))
      }
    }
    open()
    return () => {
      closed = true
      clearTimeout(retry)
      stopTimers()
      const ws = socket
      if (ws?.readyState === WebSocket.CONNECTING) {
        // Closing during the handshake makes Safari log an error: close once it has opened.
        ws.onmessage = null
        ws.onopen = () => ws.close()
      } else {
        ws?.close()
      }
    }
  }, [workspaceId, selfId])
}
