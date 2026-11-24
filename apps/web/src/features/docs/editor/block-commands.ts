import { type Editor, Extension } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection, type Transaction } from '@tiptap/pm/state'
import { type CalloutType, markerFor } from './callout'
import { newToggle, unwrapToggle } from './toggle'
import { JOIN_LISTS, ownChain, ownStep } from './own-step'

/**
 * What the block handle does. A block is a list item (the innermost one around a position), or
 * else a block of the document's top level: a paragraph, a heading, a quote, a table… Moving one
 * swaps it with its neighbour, as the Markdown is written line after line; front matter stays first.
 */

const ITEMS = new Set(['listItem', 'taskItem'])
const LISTS: Record<string, Turn> = { bulletList: 'ul', orderedList: 'ol', taskList: 'todo' }

/** What a block can be turned into, as in the «/» menu. */
export type Turn = 'p' | 'h1' | 'h2' | 'h3' | 'ul' | 'ol' | 'todo' | 'quote' | 'callout' | 'toggle' | 'code'
const ALL: Turn[] = ['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'todo', 'quote', 'callout', 'toggle', 'code']
/** The icons of the «/» menu for each of them. */
export const TURN_ICONS: Record<Turn, string> = { p: 'T', h1: 'H1', h2: 'H2', h3: 'H3', ul: '•', ol: '1.', todo: '☑', quote: '❝', callout: 'ⓘ', toggle: '▸', code: '</>' }


export interface Block {
  /** Position right before the block. */
  pos: number
  node: PMNode
}

/** Front matter, as the editor keeps it: Markdown it shows as written, starting with `---`. */
export const isFrontMatter = (node: PMNode) => node.type.name === 'rawMarkdownBlock' && /^---/.test(String(node.attrs.markdown))

/** Front matter at the very top: it is the document's, not a block to move. */
function frontMatter(doc: PMNode, pos: number) {
  const node = doc.nodeAt(pos)
  return pos === 0 && node !== null && isFrontMatter(node)
}

function blockFrom(doc: PMNode, pos: number): Block | null {
  const node = doc.nodeAt(pos)
  return node && !frontMatter(doc, pos) ? { pos, node } : null
}

/** The block around a position, or right at it between two blocks of the top level. */
export function blockAt(doc: PMNode, at: number): Block | null {
  const $pos = doc.resolve(Math.max(0, Math.min(at, doc.content.size)))
  // Right before a list item (its bullet, its checkbox): that item, not the list around it.
  const here = doc.nodeAt($pos.pos)
  if (here && ITEMS.has(here.type.name)) return blockFrom(doc, $pos.pos)
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
  // A heading is one line, and a block of code only text: what wouldn't fit isn't offered.
  let lines = false
  let atoms = false
  node.descendants((child) => {
    if (child.type.name === 'hardBreak' || (child.isText && child.text?.includes('\n'))) lines = true
    else if (child.isInline && !child.isText) atoms = true
  })
  // A toggle's title is one line of plain text too.
  const fits = (options: Turn[]) => options.filter((o) => !(lines && (o.startsWith('h') || o === 'toggle')) && !(atoms && (o === 'code' || o === 'toggle')))
  if (ITEMS.has(name)) return { current: LISTS[doc.resolve(pos).parent.type.name] ?? null, options: ['p', 'ul', 'ol', 'todo'] }
  if (name === 'paragraph') return { current: 'p', options: fits(ALL) }
  if (name === 'heading') {
    const level = node.attrs.level as number
    return { current: level <= 3 ? (`h${level}` as Turn) : null, options: fits(ALL) }
  }
  if (name === 'codeBlock') return { current: 'code', options: fits(['p', 'h1', 'h2', 'h3', 'code']) }
  if (name === 'blockquote') return { current: 'quote', options: ['p', 'quote', 'callout'] }
  if (name === 'callout') return { current: 'callout', options: ['p', 'quote', 'callout'] }
  if (name === 'toggle') return { current: 'toggle', options: ['p', 'toggle'] }
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
  if ($pos.depth > 0) return true
  if (dir < 0) return !(index === 0 && frontMatter(doc, 0))
  // The empty paragraph the editor keeps at the end, after a list or a table, is not a block to pass.
  const next = doc.child(index)
  return !(index === doc.childCount - 1 && next.type.name === 'paragraph' && next.content.size === 0)
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
  }, { joinLists: true })
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
  }, { joinLists: true })
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
    // In text, before or after: an atom selected there (front matter, a rule) would go with the next key.
    const $at = tr.doc.resolve(Math.min(from, tr.doc.content.size))
    tr.setSelection(Selection.findFrom($at, -1, true) ?? Selection.findFrom($at, 1, true) ?? Selection.near($at, -1))
    return true
  }, { joinLists: true })
}

/** Turns the block into another kind, as the «/» menu would on its text; the cursor goes to its end. */
export function turnBlock(editor: Editor, pos: number, to: Turn) {
  const node = editor.state.doc.nodeAt(pos)
  const { current, options } = turns(editor.state.doc, pos)
  if (!node || to === current || !options.includes(to)) return false
  const name = node.type.name
  // A toggle made of a line of text, with that text as its title; turned into text, its title and what it held.
  if (to === 'toggle') {
    return ownStep(editor, ({ tr }) => {
      const toggle = newToggle(tr.doc.type.schema, node.textContent)
      tr.replaceWith(pos, pos + node.nodeSize, toggle)
      tr.setSelection(TextSelection.create(tr.doc, pos + 1 + toggle.firstChild!.nodeSize - 1))
      return true
    })
  }
  if (name === 'toggle' && to === 'p') {
    return ownStep(editor, ({ tr }) => {
      const paragraph = unwrapToggle(tr, pos, node)
      tr.setSelection(TextSelection.create(tr.doc, pos + 1 + paragraph.content.size))
      return true
    }, { joinLists: true })
  }
  // A quote and a callout hold blocks alike: one becomes the other as it is, a note for a new callout.
  if ((name === 'blockquote' && to === 'callout') || (name === 'callout' && to === 'quote')) {
    return ownStep(editor, ({ tr }) => {
      // A quote whose text starts like a marker keeps it escaped: it was text in the callout, and stays text.
      const first = node.firstChild?.type.name === 'paragraph' ? node.firstChild.textContent : ''
      const attrs = to === 'callout' ? { marker: markerFor('note') } : { escapedMarker: /^\[![A-Za-z][A-Za-z0-9-]*\]/.test(first) }
      tr.setNodeMarkup(pos, editor.schema.nodes[to === 'callout' ? 'callout' : 'blockquote'], attrs)
      return true
    })
  }
  // A quote or a callout turned into text gives what it holds, whatever it is: paragraphs, a list, a table.
  if ((name === 'blockquote' || name === 'callout') && to === 'p') {
    return ownStep(editor, ({ tr }) => {
      tr.replaceWith(pos, pos + node.nodeSize, node.content)
      tr.setSelection(Selection.near(tr.doc.resolve(pos + node.content.size), -1))
      return true
    }, { joinLists: true })
  }
  // The text of the block: of its first paragraph for a list item, of the paragraphs inside for a quote.
  const item = ITEMS.has(name)
  const from = pos + (item || name === 'blockquote' ? 2 : 1)
  const end = item ? from + (node.firstChild?.content.size ?? 0) : pos + node.nodeSize - (name === 'blockquote' ? 2 : 1)
  // An item in a list in a list goes out of every one of them: lifted as its own kind of item, then
  // as each item it was in, from the nearest out.
  const $pos = editor.state.doc.resolve(pos)
  const lifts = [name]
  for (let depth = $pos.depth; depth > 0; depth--) if (ITEMS.has($pos.node(depth).type.name)) lifts.push($pos.node(depth).type.name)
  return ownChain(editor, (chain) => {
    chain.command(({ tr }) => (tr.setSelection(TextSelection.create(tr.doc, from, end)), true))
    // Each lift as far as it goes: in a list of another kind the item can stop being one on the way.
    if (item && to === 'p') for (const type of lifts) chain.command(({ commands }) => (commands.liftListItem(type), true))
    else if (to === 'p') chain.setParagraph()
    else if (to === 'h1' || to === 'h2' || to === 'h3') chain.setHeading({ level: Number(to[1]) as 1 | 2 | 3 })
    else if (to === 'ul') chain.toggleBulletList()
    else if (to === 'ol') chain.toggleOrderedList()
    else if (to === 'todo') chain.toggleTaskList()
    else if (to === 'quote') chain.toggleBlockquote()
    else if (to === 'callout') chain.wrapIn('callout', { marker: markerFor('note') })
    else chain.toggleCodeBlock()
    return chain.command(({ tr }) => (tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(end)), -1)), true))
  }, { joinLists: true })
}

/**
 * Gives a callout another type, its marker in the case it was written in. From a menu, which gives the
 * focus back as it closes: focused now, the page would scroll to where the cursor was.
 */
export function setCalloutType(editor: Editor, pos: number, type: CalloutType) {
  return ownStep(
    editor,
    ({ tr }) => {
      const node = tr.doc.nodeAt(pos)
      if (node?.type.name !== 'callout') return false
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, marker: markerFor(type, node.attrs.marker) })
      return true
    },
    { focus: false },
  )
}

/** Takes a callout away and leaves what it held, with the cursor at its end. */
export function removeCallout(editor: Editor, pos: number) {
  return turnBlock(editor, pos, 'p')
}

/** Where two lists of the same kind meet, in `node` (at `start`) and inside it. */
function meetingLists(node: PMNode, start: number, found: number[]) {
  let offset = start
  node.forEach((child, childOffset, index) => {
    const at = start + childOffset
    if (index > 0 && child.type.name in LISTS && node.child(index - 1).type === child.type) found.push(at)
    if (!child.isTextblock && !child.isLeaf) meetingLists(child, at + 1, found)
    offset = at
  })
  void offset
  return found
}

/**
 * Rules that keep the document what its Markdown says:
 * - front matter stays at the top, whatever is put before it (a dragged block, something pasted);
 * - two lists of the same kind that meet after a control moved or removed a block, or something was
 *   dropped, are one list, as Markdown reads them.
 */
export const DocumentRules = Extension.create({
  name: 'documentRules',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('documentRules'),
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some((tr) => tr.docChanged)) return null
          const tr = state.tr
          let at = -1
          state.doc.forEach((node, offset, index) => {
            if (index > 0 && at === -1 && isFrontMatter(node)) at = offset
          })
          // Unless front matter is already there: two of them (one pasted) stay where they are.
          const first = state.doc.firstChild
          if (at !== -1 && !(first && isFrontMatter(first))) {
            const node = state.doc.nodeAt(at)!
            tr.delete(at, at + node.nodeSize).insert(0, node)
          }
          if (transactions.some((t) => t.docChanged && (t.getMeta('uiEvent') === 'drop' || t.getMeta(JOIN_LISTS)))) {
            // From the end, so that each join leaves the positions before it as they were.
            for (const pos of meetingLists(tr.doc, 0, []).reverse()) tr.join(pos)
          }
          return tr.docChanged ? tr : null
        },
      }),
    ]
  },
})
