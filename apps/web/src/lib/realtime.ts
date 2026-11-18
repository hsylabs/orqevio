import { LIVE_CLOSE, type LiveMessage, type MeDTO, type RealtimeEvent } from '@orqevio/shared'
import type { QueryKey } from '@tanstack/react-query'
import { useEffect, useSyncExternalStore } from 'react'
import { createLiveRefresh } from './live-refresh'
import { keys, queryClient } from './queries'

/** Live changes refetch what they touch together, a moment later, without cancelling each other. */
const live = createLiveRefresh(queryClient)

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

/** Refetches the queries under `queryKey` soon, together with the other live changes of the moment. */
export const refreshLive = (queryKey: QueryKey) => live.refresh(queryKey)

type LiveListener = (event: RealtimeEvent) => void
const pageListeners = new Set<LiveListener>()
export function onPageEvent(fn: LiveListener) {
  pageListeners.add(fn)
  return () => {
    pageListeners.delete(fn)
  }
}
/** Tells the open page about a change made from this tab, as a live update would: it may not come. */
export function announcePage(event: RealtimeEvent) {
  for (const l of pageListeners) l(event)
}
const cardListeners = new Set<LiveListener>()
export function onCardEvent(fn: LiveListener) {
  cardListeners.add(fn)
  return () => {
    cardListeners.delete(fn)
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
    live.refresh(keys.board(event.boardId))
    live.refresh(keys.archived(event.boardId))
  }
  if (event.cardId) {
    // A deleted card can't be fetched again; an open one says it is gone (see CardSheet).
    if (event.action !== 'card.deleted') live.refresh(keys.card(event.cardId))
    else for (const key of [keys.card(event.cardId), keys.history('card', event.cardId)]) live.forget(key)
    for (const l of cardListeners) l(event)
  }
  // An open page also hears of its project, which may be deleted or restored with it inside.
  if (event.pageId || event.projectId) for (const l of pageListeners) l(event)
  if (event.pageId) {
    if (event.action === 'page.deleted') live.forget(keys.history('page', event.pageId))
    if (event.cardId) live.refresh(keys.page(event.pageId))
  }
  if (event.structure) live.refresh(keys.overview(workspaceId))
  live.refresh(keys.home(workspaceId))
  live.refresh(['activity', workspaceId])
  // Any change may put something in the trash or take it out; only an open trash refetches.
  live.refresh(keys.trash(workspaceId))
  // Only an open history refetches; a deleted page or card has none to show.
  if (event.cardId && event.action !== 'card.deleted') live.refresh(keys.history('card', event.cardId))
  if (event.pageId && event.action !== 'page.deleted') live.refresh(keys.history('page', event.pageId))
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
    let opened = false

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
        opened = true
        ping = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return
          ws.send('ping')
          clearTimeout(pongDeadline)
          // No answer: the connection is dead even if the browser has not noticed yet.
          pongDeadline = setTimeout(() => ws.close(), PONG_TIMEOUT_MS)
        }, PING_EVERY_MS)
      }
      const reconnect = () => {
        opened = false
        attempts++
        retry = setTimeout(open, Math.min(1000 * 2 ** attempts, 20_000))
      }
      ws.onclose = (event) => {
        stopTimers()
        if (closed) return
        if (event.code === LIVE_CLOSE.sessionEnded || event.code === LIVE_CLOSE.noAccess) {
          // The server refused this connection's session or access. Ask the app again: if this
          // tab has lost them, it shows the sign-in screen or "not found" and this ends here; if
          // they are still good (signed in again in another tab, say), connect again with them.
          void queryClient.invalidateQueries({ queryKey: keys.me }).then(() => {
            if (closed) return
            const state = queryClient.getQueryState<MeDTO>(keys.me)
            const stillHere = state?.status === 'success' && state.data?.user.id === selfId && state.data.workspaces.some((w) => w.id === workspaceId)
            if (stillHere) reconnect()
          })
          return
        }
        // One that never opened (the browser hides why) may mean the same: let the app check.
        if (!opened) void queryClient.invalidateQueries({ queryKey: keys.me })
        reconnect()
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
