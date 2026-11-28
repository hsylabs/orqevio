import { Extension, InputRule } from '@tiptap/core'
import type { Editor, Range } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, { exitSuggestion } from '@tiptap/suggestion'
import { blockAt, canMove, moveBlock } from './block-commands'
import { chosenRange, insertBelowPlugin, slashKey } from './insert-below'
import { readPending } from './own-step'
import type { MenuItem, MenuKind, SuggestionStore } from './suggestion-store'

interface MenuExtensionOptions {
  store: SuggestionStore | null
  items: (query: string, editor: Editor) => MenuItem[] | Promise<MenuItem[]>
  /** Whether the menu starts for what follows its character: always, unless said otherwise. */
  starts: (query: string) => boolean
  /** Called once the menu has ended, whichever way. */
  onExit: () => void
}

/** The characters a menu's own character may follow, besides the start of a line. */
const PREFIXES = [' ', ' ', '(']

function createMenuExtension(name: string, char: string, kind: MenuKind, pluginKey: PluginKey, { allowSpaces = true, inCode = true } = {}) {
  return Extension.create<MenuExtensionOptions>({
    name,
    addOptions() {
      return { store: null, items: () => [], starts: () => true, onExit: () => {} }
    },
    addProseMirrorPlugins() {
      const { store, items: fetchItems, starts, onExit } = this.options
      if (!store) return []
      let requestId = 0
      return [
        Suggestion<MenuItem, MenuItem>({
          pluginKey,
          editor: this.editor,
          char,
          allowSpaces,
          startOfLine: false,
          allowedPrefixes: PREFIXES,
          allow: ({ state, range, isActive }) => {
            const $from = state.doc.resolve(range.from)
            // A toggle's title is one line of plain text: no block, mention or link goes in it.
            if ($from.parent.type.name === 'toggleTitle') return false
            if (!inCode && inCodeAt(state.doc, range.from)) return false
            // Once it has started, it goes on while what follows its character still matches.
            return isActive || starts(state.doc.textBetween(range.from + char.length, range.to))
          },
          items: async ({ query, editor }) => {
            const id = ++requestId
            store.set({ loading: true })
            const items = await fetchItems(query, editor)
            if (id === requestId) store.set({ loading: false })
            return items
          },
          // On a line the «+» of a block opened, the choice acts on the line made anew (insert-below.ts).
          command: ({ editor, range, props }) => props.run(editor, kind === 'slash' ? chosenRange(editor, range) : range),
          render: () => ({
            onStart: (props) => {
              store.set({
                open: true,
                kind,
                items: props.items,
                index: 0,
                rect: props.clientRect?.() ?? null,
                query: props.query,
                command: props.command,
                close: () => exitSuggestion(props.editor.view, pluginKey),
              })
            },
            onUpdate: (props) => {
              store.set({ items: props.items, index: 0, rect: props.clientRect?.() ?? null, query: props.query, command: props.command })
            },
            onKeyDown: ({ event }) => {
              // With nothing listed, nothing to move through or choose: the keys do what they do in the text.
              if (!store.get().items.length && event.key !== 'Escape') return false
              if (event.key === 'ArrowDown') {
                store.move(1)
                return true
              }
              if (event.key === 'ArrowUp') {
                store.move(-1)
                return true
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                store.choose()
                return true
              }
              if (event.key === 'Escape') {
                store.set({ open: false })
                return true
              }
              return false
            },
            onExit: () => {
              store.set({ open: false, items: [], command: null, close: null })
              onExit()
            },
          }),
        }),
      ]
    },
  })
}

/** Whether `pos` is in code, a block or a span, where what is typed is kept as typed. */
function inCodeAt(doc: PMNode, pos: number) {
  const $pos = doc.resolve(pos)
  if ($pos.parent.type.spec.code) return true
  const around = $pos.nodeAfter ?? $pos.nodeBefore
  return !!around?.marks.some((mark) => mark.type.spec.code)
}

export const SlashCommands = createMenuExtension('slashCommands', '/', 'slash', slashKey)
export const Mentions = createMenuExtension('mentions', '@', 'mention', new PluginKey('mentions'))
/** «:» and the start of an emoji's name. A name has no spaces, and in code a «:» is only a «:». */
export const emojiKey = new PluginKey('emojiCommands')
export const EmojiCommands = createMenuExtension('emojiCommands', ':', 'emoji', emojiKey, { allowSpaces: false, inCode: false })

/**
 * A shortcode typed whole, `:rocket:`, turns into its emoji as the second «:» is typed, as GitHub
 * shows it; Backspace right after brings the shortcode back. Where the emoji have not been loaded
 * yet, or the name is no emoji's, it stays as typed. Not in code: input rules are not run there.
 */
export const EmojiShortcodes = Extension.create<{ find: (code: string) => string | undefined }>({
  name: 'emojiShortcodes',
  addOptions() {
    return { find: () => undefined }
  },
  addInputRules() {
    const { find } = this.options
    return [
      new InputRule({
        find: /(?:^|[\s(])(:([a-z0-9_+-]+):)$/,
        handler: ({ state, range, match }) => {
          const char = find(match[2]!)
          if (!char) return null
          // The typed «:» is already in the text, and the shortcode ends at the end of the range.
          state.tr.insertText(char, range.to - match[1]!.length, range.to)
        },
      }),
    ]
  },
})

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
  // The line a block's «+» opens for the «/» menu.
  addProseMirrorPlugins() {
    return [insertBelowPlugin(this.editor)]
  },
})
