import type { RealtimeEvent } from '@orqevio/shared'

type Listener = (event: RealtimeEvent) => void

/** What services need: tell the browsers connected to a workspace that something changed. */
export interface RealtimePublisher {
  publish(workspaceId: string, event: RealtimeEvent): void
}

/**
 * Workspace-scoped event bus. A copy of Orqevio runs as a single process, so
 * events are fanned out in memory to the browsers connected to it.
 */
export class RealtimeBus implements RealtimePublisher {
  private readonly listeners = new Map<string, Set<Listener>>()

  subscribe(workspaceId: string, listener: Listener) {
    let set = this.listeners.get(workspaceId)
    if (!set) this.listeners.set(workspaceId, (set = new Set()))
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(workspaceId)
    }
  }

  publish(workspaceId: string, event: RealtimeEvent) {
    const safe = { ...event, summary: event.summary?.slice(0, 200) }
    for (const listener of this.listeners.get(workspaceId) ?? []) {
      try {
        listener(safe)
      } catch (error) {
        console.error('[realtime] listener failed', error)
      }
    }
  }
}
