import { type Editor, type JSONContent, Node, mergeAttributes } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, Selection, TextSelection, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type NodeView } from '@tiptap/pm/view'
import i18next, { t } from 'i18next'
import { icon } from './svg-icons'

/**
 * Toggles are HTML's `<details>` as GitHub reads it in Markdown: a `<details>` and `<summary>` block,
 * the Markdown it folds, and `</details>`, each apart by a blank line. The editor shows them as a
 * title with an arrow that shows or hides what is under it. Their Markdown is what it was: the two
 * HTML blocks as written, and the summary as written unless its text is changed. Whether a toggle
 * is open is the view's, not the document's: it isn't saved or undone.
 */

/** The opening block: `<details …>`, `<summary …>`, the summary, `</summary>`, and nothing else. */
const OPENING = /^(<details(?:\s[^>]*)?>\s*<summary(?:\s[^>]*)?>)([\s\S]*?)(<\/summary>)$/i
const CLOSING = /^<\/details>$/i
/** Any block that opens a `<details>` it doesn't close, which a later `</details>` closes. */
const OPENS = (html: string) => /^<details[\s>]/i.test(html) && !/<\/details>/i.test(html)

const NEW = { head: '<details>\n<summary>', tail: '</summary>', closing: '</details>' }

let decoder: HTMLTemplateElement | null = null
/** A summary's text, as a browser shows it: its tags taken away and its entities decoded. */
export function summaryText(html: string) {
  if (!/[<&]/.test(html)) return html
  if (typeof document === 'undefined') return html.replace(/<[^>]*>/g, '')
  decoder ??= document.createElement('template')
  // A template's content is inert: nothing in it loads or runs.
  decoder.innerHTML = html
  return decoder.content.textContent ?? ''
}

/** Text written as a summary: what HTML would read as a tag or an entity, escaped. */
const encode = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const htmlOf = (node: JSONContent | undefined) => (node?.type === 'htmlBlock' ? String(node.attrs?.html ?? '') : null)

/** A document read from Markdown, with each `<details>` that has the form of a toggle made one, at any depth. */
export function foldToggles(blocks: JSONContent[]): JSONContent[] {
  const folded: JSONContent[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    const opening = OPENING.exec(htmlOf(block) ?? '')
    if (opening) {
      // Its `</details>`: the next one among its siblings that no other `<details>` before it takes.
      let depth = 0
      let end = -1
      for (let j = i + 1; j < blocks.length; j++) {
        const html = htmlOf(blocks[j])
        if (html === null) continue
        if (OPENS(html)) depth++
        else if (CLOSING.test(html) && depth-- === 0) {
          end = j
          break
        }
      }
      if (end !== -1) {
        const [, head, summary, tail] = opening
        const content = foldToggles(blocks.slice(i + 1, end))
        const text = summaryText(summary!)
        folded.push({
          type: 'toggle',
          attrs: { head, summary, tail, closing: htmlOf(blocks[end]), open: /\sopen(?:[\s=>]|$)/i.test(head!.slice(0, head!.indexOf('>') + 1)) },
          content: [{ type: 'toggleTitle', content: text ? [{ type: 'text', text }] : [] }, ...(content.length ? content : [{ type: 'paragraph' }])],
        })
        i = end
        continue
      }
    }
    folded.push(block.content && !isInline(block) ? { ...block, content: foldToggles(block.content) } : block)
  }
  return folded
}

const isInline = (node: JSONContent) => node.type === 'paragraph' || node.type === 'heading' || node.type === 'codeBlock' || node.type === 'toggleTitle'

const isEmptyParagraph = (node: JSONContent | undefined) => node?.type === 'paragraph' && !node.content?.length

/** Shows or hides what a toggle holds; not a change to save or undo. */
export function setToggleOpen(editor: Editor, pos: number, open: boolean) {
  const node = editor.state.doc.nodeAt(pos)
  if (node?.type.name !== 'toggle' || node.attrs.open === open) return false
  const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, open }).setMeta('addToHistory', false)
  // Hidden, the cursor can't stay in what it holds: it goes to the end of the title.
  const { from } = tr.selection
  const title = node.firstChild!
  if (!open && from > pos + title.nodeSize && from < pos + node.nodeSize) tr.setSelection(TextSelection.create(tr.doc, pos + 1 + title.nodeSize - 1))
  editor.view.dispatch(tr)
  return true
}

/** The toggle whose title has the cursor, if any. */
function titleToggle(editor: Editor) {
  const { $from, empty } = editor.state.selection
  if (!empty || $from.parent.type.name !== 'toggleTitle') return null
  const pos = $from.before($from.depth - 1)
  return { pos, node: editor.state.doc.nodeAt(pos)! }
}

/** A toggle in the editor: its arrow, which shows or hides what it holds, left of its title. */
class ToggleView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private button: HTMLButtonElement

  constructor(
    private node: PMNode,
    private editor: Editor,
    private getPos: () => number | undefined,
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'orq-toggle'
    this.button = document.createElement('button')
    this.button.type = 'button'
    this.button.className = 'orq-toggle-button'
    this.button.contentEditable = 'false'
    this.button.append(icon('chevronRight', 'orq-toggle-icon'))
    this.contentDOM = document.createElement('div')
    this.contentDOM.className = 'orq-toggle-content'
    this.dom.append(this.button, this.contentDOM)
    // A press on the arrow leaves the cursor and the focus where they were.
    this.button.addEventListener('mousedown', (event) => event.preventDefault())
    this.button.addEventListener('click', () => {
      const pos = this.getPos()
      if (pos !== undefined) setToggleOpen(this.editor, pos, !this.node.attrs.open)
    })
    i18next.on('languageChanged', this.render)
    this.render()
  }

  private render = () => {
    const open = !!this.node.attrs.open
    this.dom.toggleAttribute('data-open', open)
    this.button.setAttribute('aria-expanded', String(open))
    this.button.setAttribute('aria-label', t(open ? 'docs:editor.toggle.collapse' : 'docs:editor.toggle.expand'))
    this.button.title = this.button.getAttribute('aria-label')!
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    const changed = node.attrs.open !== this.node.attrs.open
    this.node = node
    if (changed) this.render()
    return true
  }

  stopEvent(event: Event) {
    return event.target instanceof globalThis.Node && this.button.contains(event.target)
  }

  // Its arrow and its own attributes are its own: the editor reads only what it holds.
  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: globalThis.Node }) {
    return this.button.contains(mutation.target) || (mutation.type === 'attributes' && mutation.target === this.dom)
  }

  destroy() {
    i18next.off('languageChanged', this.render)
  }
}

/** A closed toggle with the cursor in what it holds (undone, found, pasted into) shows it. */
const revealing = new PluginKey('toggleReveal')
const reveal = () =>
  new Plugin({
    key: revealing,
    props: {
      decorations(state) {
        const { $head } = state.selection
        const decorations: Decoration[] = []
        for (let depth = $head.depth; depth > 0; depth--) {
          const node = $head.node(depth)
          if (node.type.name !== 'toggle' || node.attrs.open || $head.index(depth) === 0) continue
          const pos = $head.before(depth)
          decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'orq-toggle--reveal' }))
        }
        return decorations.length ? DecorationSet.create(state.doc, decorations) : DecorationSet.empty
      },
    },
  })

export const ToggleTitle = Node.create({
  name: 'toggleTitle',
  content: 'text*',
  marks: '',
  defining: true,
  selectable: false,
  parseHTML() {
    return [{ tag: 'summary' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['summary', mergeAttributes(HTMLAttributes, { class: 'orq-toggle-title' }), 0]
  },
  // Written by its toggle.
  renderMarkdown: () => '',
})

export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'toggleTitle block+',
  defining: true,

  addAttributes() {
    return {
      // The opening block as written, around its summary, and the closing one.
      head: { default: NEW.head, parseHTML: (element) => element.getAttribute('data-head') ?? NEW.head, renderHTML: (attributes) => ({ 'data-head': attributes.head }) },
      summary: { default: '', parseHTML: (element) => element.getAttribute('data-summary') ?? '', renderHTML: (attributes) => ({ 'data-summary': attributes.summary }) },
      tail: { default: NEW.tail, parseHTML: (element) => element.getAttribute('data-tail') ?? NEW.tail, renderHTML: (attributes) => ({ 'data-tail': attributes.tail }) },
      closing: { default: NEW.closing, parseHTML: (element) => element.getAttribute('data-closing') ?? NEW.closing, renderHTML: (attributes) => ({ 'data-closing': attributes.closing }) },
      open: { default: false, parseHTML: (element) => element.hasAttribute('open'), renderHTML: (attributes) => (attributes.open ? { open: '' } : {}) },
    }
  },

  parseHTML() {
    return [{ tag: 'details', priority: 60 }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['details', mergeAttributes(HTMLAttributes, { class: 'orq-toggle' }), 0]
  },

  renderMarkdown: (node, helpers) => {
    const attrs = node.attrs ?? {}
    const [title, ...blocks] = node.content ?? []
    const text = (title?.content ?? []).map((child) => child.text ?? '').join('')
    const raw = String(attrs.summary ?? '')
    // As written while its text is the same; written anew, as text, once it changed.
    const summary = text === summaryText(raw) ? raw : encode(text)
    const opening = `${attrs.head ?? NEW.head}${summary}${attrs.tail ?? NEW.tail}`
    const body = blocks.length === 1 && isEmptyParagraph(blocks[0]) ? '' : helpers.renderChildren(blocks, '\n\n')
    return body ? `${opening}\n\n${body}\n\n${attrs.closing ?? NEW.closing}` : `${opening}\n\n${attrs.closing ?? NEW.closing}`
  },

  addKeyboardShortcuts() {
    return {
      // In its title: into what it holds when it is open, to a new line after it when it is closed.
      Enter: () => {
        const found = titleToggle(this.editor)
        if (!found) return false
        const { pos, node } = found
        const title = node.firstChild!
        return this.editor.commands.command(({ tr, dispatch }) => {
          if (!dispatch) return true
          if (node.attrs.open) {
            const first = pos + 1 + title.nodeSize
            const block = node.child(1)
            if (!(block.type.name === 'paragraph' && block.content.size === 0)) tr.insert(first, this.editor.schema.nodes.paragraph!.create())
            tr.setSelection(TextSelection.create(tr.doc, first + 1))
          } else {
            const after = pos + node.nodeSize
            tr.insert(after, this.editor.schema.nodes.paragraph!.create())
            tr.setSelection(TextSelection.create(tr.doc, after + 1))
          }
          dispatch(tr.scrollIntoView())
          return true
        })
      },
      // Ctrl+Enter (⌘↵) in its title shows or hides what it holds.
      'Mod-Enter': () => {
        const found = titleToggle(this.editor)
        return found ? setToggleOpen(this.editor, found.pos, !found.node.attrs.open) : false
      },
      // At the start of its title: the toggle becomes text, its title a paragraph and what it held after it.
      Backspace: () => {
        const found = titleToggle(this.editor)
        if (!found || this.editor.state.selection.$from.parentOffset !== 0) return false
        const { pos, node } = found
        return this.editor.commands.command(({ tr, dispatch }) => {
          if (!dispatch) return true
          unwrapToggle(tr, pos, node)
          tr.setSelection(Selection.near(tr.doc.resolve(pos + 1)))
          dispatch(tr.scrollIntoView())
          return true
        })
      },
    }
  },

  addProseMirrorPlugins() {
    return [reveal()]
  },

  addNodeView() {
    return ({ node, editor, getPos }) => new ToggleView(node, editor, getPos)
  },
})

/** A toggle as text: its title a paragraph, and what it held after it (an empty line it only had, not). */
export function unwrapToggle(tr: Transaction, pos: number, node: PMNode) {
  const paragraph = tr.doc.type.schema.nodes.paragraph!.create(null, node.firstChild!.content)
  const rest: PMNode[] = []
  node.forEach((child, _offset, index) => {
    if (index > 0 && !(node.childCount === 2 && child.type.name === 'paragraph' && child.content.size === 0)) rest.push(child)
  })
  tr.replaceWith(pos, pos + node.nodeSize, [paragraph, ...rest])
  return paragraph
}

/** A new toggle, open as it is being written: its title (some text, or none) and an empty line under it. */
export function newToggle(schema: Transaction['doc']['type']['schema'], title = '') {
  return schema.nodes.toggle!.create({ open: true }, [schema.nodes.toggleTitle!.create(null, title ? schema.text(title) : null), schema.nodes.paragraph!.create()])
}

/** Puts a new toggle in place of the empty line with the cursor, or after its block, with the cursor in its title. */
export function insertToggle(tr: Transaction) {
  const { $from } = tr.selection
  const toggle = newToggle(tr.doc.type.schema)
  if ($from.parent.isTextblock && $from.parent.content.size === 0 && $from.depth > 0) {
    const at = $from.before()
    tr.replaceWith(at, at + $from.parent.nodeSize, toggle)
    tr.setSelection(TextSelection.create(tr.doc, at + 2))
  } else {
    const at = $from.depth > 0 ? $from.after() : $from.pos
    tr.insert(at, toggle)
    tr.setSelection(TextSelection.create(tr.doc, at + 2))
  }
  return true
}
