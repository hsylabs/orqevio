import type { RealtimeEvent } from '@orqevio/shared'
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

/** Keeps one EventSource per open workspace; reconnects automatically. */
export function useRealtime(workspaceId: string | undefined, selfId: string | undefined) {
  useEffect(() => {
    if (!workspaceId) return
    let source: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    let closed = false
    const open = () => {
      source = new EventSource(`/api/workspaces/${workspaceId}/events`)
      source.addEventListener('ready', () => {
        if (attempts > 0) void queryClient.invalidateQueries()
        attempts = 0
      })
      source.addEventListener('change', (msg) => {
        try {
          handle(workspaceId, JSON.parse((msg as MessageEvent).data) as RealtimeEvent, selfId)
        } catch (error) {
          console.error('Invalid realtime event', error)
        }
      })
      source.onerror = () => {
        source?.close()
        if (closed) return
        attempts++
        retry = setTimeout(open, Math.min(1000 * 2 ** attempts, 20_000))
      }
    }
    open()
    return () => {
      closed = true
      clearTimeout(retry)
      source?.close()
    }
  }, [workspaceId, selfId])
}
