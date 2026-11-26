import type { Editor, Range } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state'

/**
 * The «+» beside a block's handle, as in Notion: a line below the block with «/» typed in it, so
 * that the «/» menu opens there and its search works as usual. Below a list item the line is the
 * next item, as Enter at its end would make it; an empty line is used as it is.
 *
 * Until something is chosen the line is not a change of the page to save, nor a step to undo. Chosen, the
 * block comes as one step, which one undo takes away. Closed without a choice, with nothing typed
 * after its «/», the line goes.
 */

type Kind = 'paragraph' | 'listItem' | 'taskItem'

interface Opened {
  /** The line «+» made, or the block's own empty line when `made` is false. */
  from: number
  to: number
  /** Where its «/» is. */
  slash: number
  kind: Kind
  made: boolean
}

/** The «/» menu's suggestion: whether it is open, and where. */
export const slashKey = new PluginKey('slashCommands')
const openedKey = new PluginKey<Opened | null>('insertBelow')

const ITEMS = new Set(['listItem', 'taskItem'])

function line(schema: Schema, kind: Kind, text: string) {
  const paragraph = schema.nodes.paragraph!.create(null, text ? schema.text(text) : null)
  if (kind === 'paragraph') return paragraph
  return schema.nodes[kind]!.create(kind === 'taskItem' ? { checked: false } : null, paragraph)
}

/** Where the text of a line made at `from` starts. */
const inside = (from: number, kind: Kind) => from + (kind === 'paragraph' ? 1 : 2)

/** Whether the block is an empty line: a paragraph, or an item holding only one. */
function emptyLine(node: PMNode) {
  if (node.type.name === 'paragraph') return node.content.size === 0
  return ITEMS.has(node.type.name) && node.childCount === 1 && node.firstChild!.type.name === 'paragraph' && node.firstChild!.content.size === 0
}

/** Opens the «/» menu on a line below the block at `pos` (a block of the handle: see blockAt). */
export function openBelow(editor: Editor, pos: number) {
  const { state } = editor
  const node = state.doc.nodeAt(pos)
  if (!node || !editor.isEditable) return false
  const kind: Kind = ITEMS.has(node.type.name) ? (node.type.name as Kind) : 'paragraph'
  const tr = state.tr
  let opened: Opened
  if (emptyLine(node)) {
    const slash = inside(pos, kind)
    tr.insertText('/', slash)
    opened = { from: pos, to: pos + node.nodeSize + 1, slash, kind, made: false }
  } else {
    const from = pos + node.nodeSize
    const made = line(state.schema, kind, '/')
    tr.insert(from, made)
    opened = { from, to: from + made.nodeSize, slash: inside(from, kind), kind, made: true }
  }
  tr.setSelection(TextSelection.create(tr.doc, opened.slash + 1))
    .scrollIntoView()
    .setMeta('addToHistory', false)
    .setMeta('preventUpdate', true)
    .setMeta(openedKey, opened)
  editor.view.dispatch(tr)
  editor.view.focus()
  return true
}

/**
 * What the «/» menu's choice acts on. For a line «+» opened: the page as it was before it, and then
 * the line again, empty, as the start of the step the choice makes, so that undoing it takes the
 * line away too.
 */
export function chosenRange(editor: Editor, range: Range): Range {
  const opened = openedKey.getState(editor.state)
  if (!opened || range.from !== opened.slash) return range
  const back = editor.state.tr.setMeta('addToHistory', false).setMeta('preventUpdate', true).setMeta(openedKey, null)
  if (opened.made) back.delete(opened.from, opened.to)
  else back.delete(range.from, range.to)
  editor.view.dispatch(back)
  if (!opened.made) return { from: range.from, to: range.from }
  const tr = closeHistory(editor.state.tr)
  tr.insert(opened.from, line(editor.state.schema, opened.kind, ''))
  const at = inside(opened.from, opened.kind)
  editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at)))
  return { from: at, to: at }
}

/** The «/» menu closed on a line «+» opened: with only its «/», the line goes; typed in, it stays. */
function settle(editor: Editor) {
  if (editor.isDestroyed) return
  const { state } = editor
  const opened = openedKey.getState(state)
  if (!opened || stillOpen(state, opened)) return
  const tr = state.tr.setMeta('addToHistory', false).setMeta('preventUpdate', true).setMeta(openedKey, null)
  const node = state.doc.nodeAt(opened.from)
  if (node && node.textContent === '/') {
    const wasIn = state.selection.from >= opened.from && state.selection.to <= opened.to
    if (opened.made) tr.delete(opened.from, opened.to)
    else tr.delete(opened.slash, opened.slash + 1)
    // The cursor, if it was in the line, goes to the end of the block above it.
    if (wasIn) tr.setSelection(Selection.near(tr.doc.resolve(Math.min(opened.from, tr.doc.content.size)), -1))
  }
  editor.view.dispatch(tr)
}

const stillOpen = (state: Editor['state'], opened: Opened) => {
  const suggestion = slashKey.getState(state) as { active: boolean; range: Range } | undefined
  return Boolean(suggestion?.active && suggestion.range.from === opened.slash)
}

/** Keeps the line «+» opened where it is as the page changes, and settles it as the menu closes. */
export function insertBelowPlugin(editor: Editor) {
  return new Plugin<Opened | null>({
    key: openedKey,
    state: {
      init: () => null,
      apply(tr, value) {
        const meta = tr.getMeta(openedKey) as Opened | null | undefined
        if (meta !== undefined) return meta
        if (!value || !tr.docChanged) return value
        const slash = tr.mapping.mapResult(value.slash, 1)
        const from = tr.mapping.mapResult(value.from, 1)
        const to = tr.mapping.mapResult(value.to, -1)
        if (slash.deleted || from.deleted || to.deleted) return null
        return { ...value, from: from.pos, to: to.pos, slash: slash.pos }
      },
    },
    view: () => ({
      update(view) {
        const opened = openedKey.getState(view.state)
        // After the update that closed the menu, not inside it.
        if (opened && !stillOpen(view.state, opened)) queueMicrotask(() => settle(editor))
      },
    }),
  })
}
