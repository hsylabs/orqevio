import type { Editor, Range } from '@tiptap/core'
import { useSyncExternalStore } from 'react'

export interface MenuItem {
  id: string
  title: string
  subtitle?: string
  group?: string
  icon?: string
  run: (editor: Editor, range: Range) => void
}

export interface SuggestionState {
  open: boolean
  kind: 'slash' | 'mention'
  items: MenuItem[]
  index: number
  rect: DOMRect | null
  query: string
  loading: boolean
  command: ((item: MenuItem) => void) | null
}

/** Small external store bridging TipTap's suggestion plugin and the React menu. */
export function createSuggestionStore() {
  let state: SuggestionState = { open: false, kind: 'slash', items: [], index: 0, rect: null, query: '', loading: false, command: null }
  const listeners = new Set<() => void>()
  const set = (patch: Partial<SuggestionState>) => {
    state = { ...state, ...patch }
    for (const l of listeners) l()
  }
  return {
    get: () => state,
    set,
    subscribe(fn: () => void) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    move(delta: number) {
      if (!state.items.length) return
      set({ index: (state.index + delta + state.items.length) % state.items.length })
    },
    choose(index = state.index) {
      const item = state.items[index]
      if (item && state.command) state.command(item)
    },
  }
}

export type SuggestionStore = ReturnType<typeof createSuggestionStore>

export function useSuggestionState(store: SuggestionStore) {
  return useSyncExternalStore(store.subscribe, store.get)
}
