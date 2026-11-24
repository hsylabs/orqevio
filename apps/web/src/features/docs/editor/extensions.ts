import { Extension } from '@tiptap/core'
import type { Editor, Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { blockAt, canMove, moveBlock } from './block-commands'
import { readPending } from './own-step'
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

/**
 * The keys of the block handle: Ctrl+Shift+↑/↓ (⌘⇧↑/↓) moves the block with the cursor, and Ctrl+/
 * (⌘/) opens its menu, through `storage.openMenu`, which the handle sets. Before the other keys: on
 * a Spanish or German keyboard «/» is Shift+7, and Ctrl+Shift+7 would make a numbered list.
 */
export const BlockKeys = Extension.create<object, { openMenu: ((pos: number) => void) | null }>({
  name: 'blockKeys',
  priority: 1000,
  addStorage() {
    return { openMenu: null }
  },
  addKeyboardShortcuts() {
    // The block with the cursor, also where a click just before the key put it.
    const cursor = () => {
      readPending(this.editor)
      return blockAt(this.editor.state.doc, this.editor.state.selection.from)
    }
    const move = (dir: -1 | 1) => () => {
      const block = cursor()
      if (!block) return false
      if (canMove(this.editor.state.doc, block.pos, dir)) moveBlock(this.editor, block.pos, dir)
      return true
    }
    const menu = () => {
      const block = cursor()
      if (!block || !this.storage.openMenu) return false
      this.storage.openMenu(block.pos)
      return true
    }
    return { 'Mod-Shift-ArrowUp': move(-1), 'Mod-Shift-ArrowDown': move(1), 'Mod-/': menu }
  },
})
