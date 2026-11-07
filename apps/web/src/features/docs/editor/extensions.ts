import { Extension } from '@tiptap/core'
import type { Editor, Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import type { MenuItem, SuggestionStore } from './suggestion-store'

interface MenuExtensionOptions {
  store: SuggestionStore | null
  items: (query: string, editor: Editor) => MenuItem[] | Promise<MenuItem[]>
}

function createMenuExtension(name: string, char: string, kind: 'slash' | 'mention') {
  return Extension.create<MenuExtensionOptions>({
    name,
    addOptions() {
      return { store: null, items: () => [] }
    },
    addProseMirrorPlugins() {
      const store = this.options.store
      const fetchItems = this.options.items
      if (!store) return []
      let requestId = 0
      return [
        Suggestion<MenuItem, MenuItem>({
          pluginKey: new PluginKey(name),
          editor: this.editor,
          char,
          allowSpaces: true,
          startOfLine: false,
          allowedPrefixes: [' ', ' ', '('],
          items: async ({ query, editor }) => {
            const id = ++requestId
            store.set({ loading: true })
            const items = await fetchItems(query, editor)
            if (id === requestId) store.set({ loading: false })
            return items
          },
          command: ({ editor, range, props }) => props.run(editor, range),
          render: () => ({
            onStart: (props) => {
              store.set({ open: true, kind, items: props.items, index: 0, rect: props.clientRect?.() ?? null, query: props.query, command: props.command })
            },
            onUpdate: (props) => {
              store.set({ items: props.items, index: 0, rect: props.clientRect?.() ?? null, query: props.query, command: props.command })
            },
            onKeyDown: ({ event }) => {
              if (event.key === 'ArrowDown') {
                store.move(1)
                return true
              }
              if (event.key === 'ArrowUp') {
                store.move(-1)
                return true
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                if (!store.get().items.length) return false
                store.choose()
                return true
              }
              if (event.key === 'Escape') {
                store.set({ open: false })
                return true
              }
              return false
            },
            onExit: () => store.set({ open: false, items: [], command: null }),
          }),
        }),
      ]
    },
  })
}

export const SlashCommands = createMenuExtension('slashCommands', '/', 'slash')
export const Mentions = createMenuExtension('mentions', '@', 'mention')

export type { Range }
