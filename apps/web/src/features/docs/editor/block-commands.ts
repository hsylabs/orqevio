import type { Editor } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Selection, TextSelection, type Transaction } from '@tiptap/pm/state'
import { ownChain, ownStep } from './own-step'

/**
 * What the block handle does. A block is a list item (the innermost one around a position), or
 * else a block of the document's top level: a paragraph, a heading, a quote, a table… Moving one
 * swaps it with its neighbour, as the Markdown is written line after line; front matter stays first.
 */

const ITEMS = new Set(['listItem', 'taskItem'])
const LISTS: Record<string, Turn> = { bulletList: 'ul', orderedList: 'ol', taskList: 'todo' }

/** What a block can be turned into, as in the «/» menu. */
export type Turn = 'p' | 'h1' | 'h2' | 'h3' | 'ul' | 'ol' | 'todo' | 'quote' | 'code'
const ALL: Turn[] = ['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'todo', 'quote', 'code']
/** The icons of the «/» menu for each of them. */
export const TURN_ICONS: Record<Turn, string> = { p: 'T', h1: 'H1', h2: 'H2', h3: 'H3', ul: '•', ol: '1.', todo: '☑', quote: '❝', code: '</>' }

export const isItem = (node: PMNode) => ITEMS.has(node.type.name)

export interface Block {
  /** Position right before the block. */
  pos: number
  node: PMNode
}

/** Front matter (`---` or `+++` at the very top): it is the document's, not a block to move. */
function frontMatter(doc: PMNode, pos: number) {
  const node = doc.nodeAt(pos)
  return pos === 0 && node?.type.name === 'rawMarkdownBlock' && /^(---|\+\+\+)/.test(String(node.attrs.markdown))
}

function blockFrom(doc: PMNode, pos: number): Block | null {
  const node = doc.nodeAt(pos)
  return node && !frontMatter(doc, pos) ? { pos, node } : null
}

/** The block around a position, or right at it between two blocks of the top level. */
export function blockAt(doc: PMNode, at: number): Block | null {
  const $pos = doc.resolve(Math.max(0, Math.min(at, doc.content.size)))
  for (let depth = $pos.depth; depth > 0; depth--) {
    if (ITEMS.has($pos.node(depth).type.name)) return blockFrom(doc, $pos.before(depth))
  }
  if ($pos.depth > 0) return blockFrom(doc, $pos.before(1))
  if (doc.nodeAt($pos.pos)) return blockFrom(doc, $pos.pos)
  const before = $pos.nodeBefore
  return before ? blockFrom(doc, $pos.pos - before.nodeSize) : null
}

/** What the block is now, if it is one of the «/» menu's, and what it can be turned into. */
export function turns(doc: PMNode, pos: number): { current: Turn | null; options: Turn[] } {
  const node = doc.nodeAt(pos)
  if (!node) return { current: null, options: [] }
  const name = node.type.name
  if (ITEMS.has(name)) return { current: LISTS[doc.resolve(pos).parent.type.name] ?? null, options: ['p', 'ul', 'ol', 'todo'] }
  if (name === 'paragraph') return { current: 'p', options: ALL }
  if (name === 'heading') {
    const level = node.attrs.level as number
    return { current: level <= 3 ? (`h${level}` as Turn) : null, options: ALL }
  }
  if (name === 'codeBlock') return { current: 'code', options: ['p', 'h1', 'h2', 'h3', 'code'] }
  if (name === 'blockquote') return { current: 'quote', options: ['p', 'quote'] }
  return { current: null, options: [] }
}

/**
 * Where the cursor goes in a block that moved or was copied: where it was in it. With the whole block
 * selected (its handle's menu), at the end of its text, or the block still selected if it has none.
 */
function placeIn(tr: Transaction, was: Selection, oldPos: number, node: PMNode, newPos: number) {
  if (was instanceof NodeSelection && was.from === oldPos) {
    const end = Selection.findFrom(tr.doc.resolve(newPos + node.nodeSize - 1), -1, true)
    return tr.setSelection(end && end.from > newPos ? end : NodeSelection.create(tr.doc, newPos))
  }
  const offset = was.from >= oldPos && was.from <= oldPos + node.nodeSize ? was.from - oldPos : 1
  return tr.setSelection(Selection.near(tr.doc.resolve(Math.min(newPos + offset, tr.doc.content.size))))
}

/** Whether the block can go up (-1) or down (1): there is a neighbour, and it isn't the front matter. */
export function canMove(doc: PMNode, pos: number, dir: -1 | 1) {
  const $pos = doc.resolve(pos)
  const index = $pos.index() + dir
  if (index < 0 || index >= $pos.parent.childCount) return false
  return !(dir < 0 && $pos.depth === 0 && index === 0 && frontMatter(doc, 0))
}

/** Swaps the block with the one above (-1) or below (1). */
export function moveBlock(editor: Editor, pos: number, dir: -1 | 1) {
  return ownStep(editor, ({ tr }) => {
    const node = tr.doc.nodeAt(pos)
    if (!node || !canMove(tr.doc, pos, dir)) return false
    const $pos = tr.doc.resolve(pos)
    const other = $pos.parent.child($pos.index() + dir)
    const was = tr.selection
    if (dir < 0) {
      const from = pos - other.nodeSize
      tr.replaceWith(from, pos + node.nodeSize, Fragment.from([node, other]))
      placeIn(tr, was, pos, node, from)
    } else {
      tr.replaceWith(pos, pos + node.nodeSize + other.nodeSize, Fragment.from([other, node]))
      placeIn(tr, was, pos, node, pos + other.nodeSize)
    }
    return true
  })
}

/** A copy of the block right below it, with the cursor in the copy. */
export function duplicateBlock(editor: Editor, pos: number) {
  return ownStep(editor, ({ tr }) => {
    const node = tr.doc.nodeAt(pos)
    if (!node) return false
    const was = tr.selection
    tr.insert(pos + node.nodeSize, node)
    placeIn(tr, was, pos, node, pos + node.nodeSize)
    return true
  })
}

/** The block goes, and a list with it when it was its only item. */
export function deleteBlock(editor: Editor, pos: number) {
  return ownStep(editor, ({ tr }) => {
    const node = tr.doc.nodeAt(pos)
    if (!node) return false
    const $pos = tr.doc.resolve(pos)
    const whole = ITEMS.has(node.type.name) && $pos.parent.childCount === 1
    const from = whole ? $pos.before() : pos
    const to = whole ? $pos.after() : pos + node.nodeSize
    tr.delete(from, to)
    tr.setSelection(Selection.near(tr.doc.resolve(Math.min(from, tr.doc.content.size)), -1))
    return true
  })
}

/** Turns the block into another kind, as the «/» menu would on its text; the cursor goes to its end. */
export function turnBlock(editor: Editor, pos: number, to: Turn) {
  const node = editor.state.doc.nodeAt(pos)
  const { current, options } = turns(editor.state.doc, pos)
  if (!node || to === current || !options.includes(to)) return false
  // The text of the block: of its first paragraph for a list item, of the paragraphs inside for a quote.
  const item = ITEMS.has(node.type.name)
  const from = pos + (item || node.type.name === 'blockquote' ? 2 : 1)
  const end = item ? from + (node.firstChild?.content.size ?? 0) : pos + node.nodeSize - (node.type.name === 'blockquote' ? 2 : 1)
  return ownChain(editor, (chain) => {
    chain.command(({ tr }) => (tr.setSelection(TextSelection.create(tr.doc, from, end)), true))
    if (item && to === 'p') chain.liftListItem(node.type.name)
    else if (to === 'p' && node.type.name === 'blockquote') chain.lift('blockquote')
    else if (to === 'p') chain.setParagraph()
    else if (to === 'h1' || to === 'h2' || to === 'h3') chain.setHeading({ level: Number(to[1]) as 1 | 2 | 3 })
    else if (to === 'ul') chain.toggleBulletList()
    else if (to === 'ol') chain.toggleOrderedList()
    else if (to === 'todo') chain.toggleTaskList()
    else if (to === 'quote') chain.toggleBlockquote()
    else chain.toggleCodeBlock()
    return chain.command(({ tr }) => (tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(end)), -1)), true))
  })
}
