import { type Editor, type JSONContent, Node, isMacOS, mergeAttributes } from '@tiptap/core'
import { type Node as PMNode, Slice } from '@tiptap/pm/model'
import { type EditorState, NodeSelection, Plugin, PluginKey, Selection, TextSelection, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type NodeView } from '@tiptap/pm/view'
import i18next, { t } from 'i18next'
import { JOIN_LISTS } from './own-step'
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
/** GitHub's documented form: `<details>` alone, and `<summary>…</summary>` alone after a blank line. */
const DETAILS = /^<details(?:\s[^>]*)?>$/i
const SUMMARY = /^(<summary(?:\s[^>]*)?>)([\s\S]*?)(<\/summary>)$/i
const CLOSING = /^<\/details>$/i
/** What can be written before a summary: one of the forms above. */
const HEAD = /^<details(?:\s[^>]*)?>(?:[^\S\n]*\n?[^\S\n]*|\n\n)<summary(?:\s[^>]*)?>$/i
/** A head that can be written back: one of the forms above, no blank line in either tag (it would end its HTML block there). */
const isHead = (head: string) => HEAD.test(head) && !head.includes('\r') && !/\n[^\S\n]*\n/.test(head.replace(/>\n\n</, '><'))
const TAIL = /^<\/summary>$/i
/** A summary that is one: no tag that would end it, nor a blank line that would end its HTML block. */
const isSummary = (html: string) => !/<\/?(?:summary|details)(?=[\s>])/i.test(html) && !/\n[^\S\n]*\n/.test(html) && !html.includes('\r')

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

/** Spaces and line breaks as HTML shows them: one space. */
const oneSpace = (text: string) => text.replace(/[\t\n\f\r ]+/g, ' ')
/** …and none at either end. */
const collapse = (text: string) => oneSpace(text).replace(/^ | $/g, '')

/** The title a summary is shown with. */
const titleOf = (summary: string) => collapse(summaryText(summary))

/** Text written as a summary: what HTML would read as a tag or an entity, escaped. */
const encode = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;')

/** Whether a `<details>` written so starts open: its `open` attribute, not a word in another one's value. */
function startsOpen(head: string) {
  const tag = head.slice(0, head.indexOf('>') + 1).replace(/=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/g, '')
  return /\sopen(?=[\s/>])/i.test(tag)
}

const htmlOf = (node: JSONContent | undefined) => (node?.type === 'htmlBlock' ? String(node.attrs?.html ?? '') : null)

/** A toggle's opening at `index`: one block, or GitHub's two; null if there is none. */
function openingAt(blocks: JSONContent[], index: number) {
  const html = htmlOf(blocks[index])
  if (html === null) return null
  let found: { head: string; summary: string; tail: string; size: number } | null = null
  const opening = OPENING.exec(html)
  if (opening) found = { head: opening[1]!, summary: opening[2]!, tail: opening[3]!, size: 1 }
  else if (DETAILS.test(html)) {
    const summary = SUMMARY.exec(htmlOf(blocks[index + 1]) ?? '')
    if (summary) found = { head: `${html}\n\n${summary[1]}`, summary: summary[2]!, tail: summary[3]!, size: 2 }
  }
  return found && isSummary(found.summary) ? found : null
}

/**
 * The `</details>` of a toggle whose content starts at `from`: the next one among its siblings that
 * no `<details>` opened after it takes. None (-1) when other HTML closes it first, as in
 * `<img src="…">\n</details>`: what that closes isn't for the editor to guess.
 */
function closingOf(blocks: JSONContent[], from: number) {
  let depth = 0
  for (let j = from; j < blocks.length; j++) {
    const html = htmlOf(blocks[j])
    if (html === null) continue
    if (CLOSING.test(html)) {
      if (depth === 0) return j
      depth--
      continue
    }
    for (const tag of html.matchAll(/<(\/?)details(?=[\s>])/gi)) {
      depth += tag[1] ? -1 : 1
      if (depth < 0) return -1
    }
  }
  return -1
}

/** A document read from Markdown, with each `<details>` that has the form of a toggle made one, at any depth. */
export function foldToggles(blocks: JSONContent[]): JSONContent[] {
  const folded: JSONContent[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    const opening = openingAt(blocks, i)
    const end = opening ? closingOf(blocks, i + opening.size) : -1
    if (opening && end !== -1) {
      const content = foldToggles(blocks.slice(i + opening.size, end))
      const text = titleOf(opening.summary)
      folded.push({
        type: 'toggle',
        attrs: {
          head: opening.head,
          summary: opening.summary,
          tail: opening.tail,
          closing: htmlOf(blocks[end]),
          open: startsOpen(opening.head),
          // Only an empty line it held: written back, not taken for an empty toggle.
          blank: content.length === 1 && isEmptyParagraph(content[0]),
        },
        content: [{ type: 'toggleTitle', content: text ? [{ type: 'text', text }] : [] }, ...(content.length ? content : [{ type: 'paragraph' }])],
      })
      i = end
      continue
    }
    folded.push(block.content && !isInline(block) ? { ...block, content: foldToggles(block.content) } : block)
  }
  return folded
}

const isInline = (node: JSONContent) => node.type === 'paragraph' || node.type === 'heading' || node.type === 'codeBlock' || node.type === 'toggleTitle'

const isEmptyParagraph = (node: JSONContent | undefined) => node?.type === 'paragraph' && !node.content?.length

/** A line a toggle's title can take as it is: text alone, without formatting, links or pictures. */
const isPlain = (node: PMNode) => node.type.name === 'paragraph' && node.content.content.every((child) => child.isText && !child.marks.length)

/** Set on a change that only shows or hides toggles: not one of the page's (BlockControls). */
export const TOGGLE_VIEW = 'toggleView'

/** Shows or hides what a toggle holds; not a change to save or undo. */
export function setToggleOpen(editor: Editor, pos: number, open: boolean) {
  const node = editor.state.doc.nodeAt(pos)
  if (node?.type.name !== 'toggle' || node.attrs.open === open) return false
  const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, open }).setMeta('addToHistory', false).setMeta(TOGGLE_VIEW, true)
  // Hidden, the cursor can't stay in what it holds, nor a selection end there: it goes to the end of the title.
  const title = node.firstChild!
  const hidden = (at: number) => at > pos + title.nodeSize && at < pos + node.nodeSize
  if (!open && (hidden(tr.selection.from) || hidden(tr.selection.to))) tr.setSelection(TextSelection.create(tr.doc, pos + title.nodeSize))
  editor.view.dispatch(tr)
  return true
}

/** Each toggle of a page, in order: its title, whether it is open, and whether the reader opened or closed it. */
export function togglesShown(doc: PMNode) {
  const shown: Array<{ title: string; open: boolean; changed: boolean }> = []
  doc.descendants((node) => {
    if (node.type.name === 'toggle') shown.push({ title: collapse(node.firstChild!.textContent), open: !!node.attrs.open, changed: !!node.attrs.open !== startsOpen(String(node.attrs.head)) })
    return !node.isTextblock
  })
  return shown
}

/**
 * A page read again (from another tab, an agent) with its toggles as the reader left them: those
 * they opened or closed, found by their title in the same order, stay so.
 */
export function showTogglesAsBefore(editor: Editor, before: ReturnType<typeof togglesShown>) {
  if (!before.some((toggle) => toggle.changed)) return
  const tr = editor.state.tr
  let next = 0
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'toggle') return !node.isTextblock
    const title = collapse(node.firstChild!.textContent)
    const found = before.findIndex((toggle, index) => index >= next && toggle.title === title)
    if (found === -1) return true
    next = found + 1
    const { changed, open } = before[found]!
    if (changed && !!node.attrs.open !== open) tr.setNodeMarkup(pos, undefined, { ...node.attrs, open })
    return true
  })
  if (tr.docChanged) editor.view.dispatch(tr.setMeta('addToHistory', false).setMeta(TOGGLE_VIEW, true))
}

/** The toggle whose title has the selection, if any. */
function titleToggle(state: EditorState) {
  const { $from, $to } = state.selection
  if ($from.parent.type.name !== 'toggleTitle' || !$from.sameParent($to)) return null
  const pos = $from.before($from.depth - 1)
  return { pos, node: state.doc.nodeAt(pos)! }
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

/**
 * A closed toggle with the selection in what it holds (undone, found, pasted into) shows it; an
 * empty title says what it is for while the page can be edited. A title takes what is pasted into it
 * as one line of text.
 */
const decorating = new PluginKey<{ language: string; set: DecorationSet }>('toggleDecorations')
/** The placeholders of the empty titles of a page. */
function placeholders(doc: PMNode) {
  const found: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'toggleTitle' && node.content.size === 0) found.push(Decoration.node(pos, pos + node.nodeSize, { class: 'is-empty', 'data-placeholder': t('docs:editor.toggle.title') }))
    return !node.isTextblock
  })
  return DecorationSet.create(doc, found)
}
const decorations = (editor: Editor) =>
  new Plugin({
    key: decorating,
    state: {
      init: (_config, state) => ({ language: i18next.language, set: placeholders(state.doc) }),
      // Drawn again when the page changes, or with the next change of any kind once the language has.
      apply: (tr, value) => (tr.docChanged || value.language !== i18next.language ? { language: i18next.language, set: placeholders(tr.doc) } : value),
    },
    props: {
      decorations(state) {
        const found: Decoration[] = []
        const revealed = new Set<number>()
        for (const $pos of [state.selection.$from, state.selection.$to]) {
          for (let depth = $pos.depth; depth > 0; depth--) {
            const node = $pos.node(depth)
            const pos = $pos.before(depth)
            if (node.type.name !== 'toggle' || node.attrs.open || $pos.index(depth) === 0 || revealed.has(pos)) continue
            revealed.add(pos)
            found.push(Decoration.node(pos, pos + node.nodeSize, { class: 'orq-toggle--reveal' }))
          }
        }
        const titles = editor.isEditable ? decorating.getState(state)!.set : DecorationSet.empty
        return found.length ? titles.add(state.doc, found) : titles
      },
      handlePaste(view, event, slice) {
        if (!titleToggle(view.state)) return false
        const text = oneSpace(event.clipboardData?.getData('text/plain') || slice.content.textBetween(0, slice.content.size, ' ', ' '))
        if (text) view.dispatch(view.state.tr.insertText(text).scrollIntoView())
        return true
      },
    },
  })

export const ToggleTitle = Node.create({
  name: 'toggleTitle',
  content: 'text*',
  marks: '',
  defining: true,
  selectable: false,
  // Its text is the summary's, plain: what is typed in it is never Markdown (a rule, bold), and
  // Shift+Enter doesn't break it (see Toggle). Spaces in pasted HTML still collapse as anywhere else.
  code: true,
  whitespace: 'normal',
  parseHTML() {
    return [{ tag: 'summary' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['summary', mergeAttributes(HTMLAttributes, { class: 'orq-toggle-title' }), 0]
  },
  // Written by its toggle.
  renderMarkdown: () => '',
})

/** An attribute read from a toggle copied in the editor, if it has the form it must have to be written back; otherwise its default. */
const checked = (name: string, valid: (value: string) => boolean, fallback: string) => ({
  default: fallback,
  parseHTML: (element: HTMLElement) => {
    const value = element.getAttribute(`data-${name}`)
    return value !== null && valid(value) ? value : fallback
  },
  renderHTML: (attributes: Record<string, unknown>) => ({ [`data-${name}`]: attributes[name] }),
})

export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'toggleTitle block+',
  defining: true,

  addAttributes() {
    return {
      // The opening block as written, around its summary, and the closing one.
      head: checked('head', isHead, NEW.head),
      summary: checked('summary', isSummary, ''),
      tail: checked('tail', (value) => TAIL.test(value), NEW.tail),
      closing: checked('closing', (value) => CLOSING.test(value), NEW.closing),
      open: { default: false, parseHTML: (element) => element.hasAttribute('open'), renderHTML: (attributes) => (attributes.open ? { open: '' } : {}) },
      blank: { default: false, parseHTML: (element) => element.hasAttribute('data-blank'), renderHTML: (attributes) => (attributes.blank ? { 'data-blank': '' } : {}) },
    }
  },

  parseHTML() {
    return [{ tag: 'details', priority: 60 }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['details', mergeAttributes(HTMLAttributes, { class: 'orq-toggle' }), 0]
  },

  renderMarkdown: (node, helpers, context) => {
    const attrs = node.attrs ?? {}
    const [title, ...blocks] = node.content ?? []
    const text = collapse((title?.content ?? []).map((child) => child.text ?? '').join(''))
    const raw = String(attrs.summary ?? '')
    // As written while its text is the same; written anew, as text, once it changed.
    const summary = text === titleOf(raw) ? raw : encode(text)
    const opening = `${attrs.head ?? NEW.head}${summary}${attrs.tail ?? NEW.tail}`
    const closing = String(attrs.closing ?? NEW.closing)
    // The empty line a toggle has in the editor for nothing held isn't written; one it was read with is.
    const held = blocks.length === 1 && isEmptyParagraph(blocks[0]) && !attrs.blank ? [] : blocks
    // In a list item, the block after it comes on the next line, which would still be its `</details>`
    // HTML block: a blank line after it ends that block.
    const end = ['listItem', 'taskItem'].includes(String(context?.parentType)) ? '\n' : ''
    if (!held.length) return `${opening}\n\n${closing}${end}`
    // Each block with its index in the toggle, after its title: an empty paragraph is written as it is
    // after the block before it.
    const body = held.map((block, index) => helpers.renderChild?.(block, index + 1) ?? helpers.renderChildren([block])).join('\n\n')
    return `${opening}\n\n${body}\n\n${closing}${end}`
  },

  addKeyboardShortcuts() {
    // In its title: into what it holds when it is open, to a new line after it when it is closed.
    const enter = () => {
      const found = titleToggle(this.editor.state)
      if (!found) return false
      return this.editor.commands.command(({ tr, dispatch }) => {
        if (!dispatch) return true
        tr.deleteSelection()
        const node = tr.doc.nodeAt(found.pos)!
        const title = node.firstChild!
        if (node.attrs.open) {
          const first = found.pos + 1 + title.nodeSize
          const block = node.child(1)
          if (!(block.type.name === 'paragraph' && block.content.size === 0)) tr.insert(first, this.editor.schema.nodes.paragraph!.create())
          tr.setSelection(TextSelection.create(tr.doc, first + 1))
        } else {
          const after = found.pos + node.nodeSize
          const next = tr.doc.nodeAt(after)
          if (!(next?.type.name === 'paragraph' && next.content.size === 0)) tr.insert(after, this.editor.schema.nodes.paragraph!.create())
          tr.setSelection(TextSelection.create(tr.doc, after + 1))
        }
        dispatch(tr.scrollIntoView())
        return true
      })
    }
    return {
      Enter: enter,
      'Shift-Enter': enter,
      // Ctrl+Enter (⌘↵) in its title shows or hides what it holds.
      'Mod-Enter': () => {
        const found = titleToggle(this.editor.state)
        return found ? setToggleOpen(this.editor, found.pos, !found.node.attrs.open) : false
      },
      // Every key the editor deletes backwards or forwards with, as TipTap binds them (with Ctrl, ⌘, ⌥ or ⇧ too).
      ...Object.fromEntries(BACKWARD.map((key) => [key, () => backspace(this.editor)])),
      ...Object.fromEntries(FORWARD.map((key) => [key, () => deleteForward(this.editor)])),
    }
  },

  addProseMirrorPlugins() {
    return [decorations(this.editor)]
  },

  addNodeView() {
    return ({ node, editor, getPos }) => new ToggleView(node, editor, getPos)
  },
})

const BACKWARD = ['Backspace', 'Mod-Backspace', 'Shift-Backspace', ...(isMacOS() ? ['Alt-Backspace', 'Ctrl-h'] : [])]
const FORWARD = ['Delete', 'Mod-Delete', ...(isMacOS() ? ['Ctrl-d', 'Ctrl-Alt-Backspace', 'Alt-Delete', 'Alt-d'] : [])]

/** At the end of a title: what the toggle holds comes up into it only if it is open (see intoTitle). */
function deleteForward(editor: Editor) {
  const { selection } = editor.state
  const found = titleToggle(editor.state)
  if (!found || !selection.empty || selection.$from.parentOffset !== selection.$from.parent.content.size) return false
  if (!found.node.attrs.open) return true
  return intoTitle(editor, found.pos, 'forward')
}

/**
 * The first block a toggle holds, brought up into its title (Backspace at its start, Delete at the
 * end of the title): its text joins the title if it is plain text or nothing, which is all a title
 * takes, and the block goes (an empty line stays if it was the only one). Otherwise the cursor only
 * moves: to the end of the title, or into the block.
 */
function intoTitle(editor: Editor, pos: number, direction: 'back' | 'forward') {
  const toggle = editor.state.doc.nodeAt(pos)!
  const title = toggle.firstChild!
  const block = toggle.child(1)
  const end = pos + title.nodeSize
  const start = end + 1
  if (block.content.size && !isPlain(block)) return editor.commands.setTextSelection(direction === 'back' ? end : Selection.near(editor.state.doc.resolve(start + 1)).from)
  return editor.commands.command(({ tr, dispatch }) => {
    if (!dispatch) return true
    if (toggle.childCount > 2) tr.delete(start, start + block.nodeSize)
    else if (block.content.size || block.type.name !== 'paragraph') tr.replaceWith(start, start + block.nodeSize, editor.schema.nodes.paragraph!.create())
    if (block.textContent) tr.insertText(block.textContent, end)
    tr.setSelection(TextSelection.create(tr.doc, end))
    dispatch(tr.scrollIntoView())
    return true
  })
}

/** The block where the line at `$from` is first, out through quotes and callouts it is first in: where Backspace there would take it. */
function lineBlock($from: Selection['$from']) {
  let depth = $from.depth - 1
  while (depth > 0 && $from.index(depth) === 0 && ['blockquote', 'callout'].includes($from.node(depth).type.name)) depth--
  return depth
}

/**
 * Backspace at the start of a line, around toggles:
 * - at the start of a title, the toggle becomes text: its title a paragraph and what it held after it;
 * - at the start of the first block it holds, that block goes up into its title (see intoTitle);
 * - right after a closed toggle, or at the start of a quote or callout right after one, the toggle
 *   is selected rather than the line hidden in it; an empty line goes, the cursor to its title's end;
 * - right after an open one, a paragraph's text joins the last line it holds, as after a quote.
 */
function backspace(editor: Editor) {
  const { selection, doc } = editor.state
  if (!selection.empty) return false
  const { $from } = selection
  if ($from.parentOffset !== 0 || !$from.parent.isTextblock || $from.depth < 1) return false
  if ($from.parent.type.name === 'toggleTitle') {
    const pos = $from.before($from.depth - 1)
    const node = doc.nodeAt(pos)!
    return editor.commands.command(({ tr, dispatch }) => {
      if (!dispatch) return true
      unwrapToggle(tr, pos, node)
      tr.setSelection(Selection.near(tr.doc.resolve(pos + 1))).setMeta(JOIN_LISTS, true)
      dispatch(tr.scrollIntoView())
      return true
    })
  }
  if ($from.node($from.depth - 1).type.name === 'toggle' && $from.index($from.depth - 1) === 1) return intoTitle(editor, $from.before($from.depth - 1), 'back')
  const depth = lineBlock($from)
  const index = $from.index(depth)
  if (index === 0) return false
  const previous = $from.node(depth).child(index - 1)
  if (previous.type.name !== 'toggle') return false
  const block = $from.before(depth + 1)
  const at = block - previous.nodeSize
  if (!previous.attrs.open) {
    // An empty line right after it goes (the page's last one stays, as the editor would put it back),
    // the cursor to the end of its title, which shows. An empty block of code becomes a line first.
    if (depth === $from.depth - 1 && $from.parent.content.size === 0) {
      if ($from.parent.type.spec.code) return false
      const title = at + previous.firstChild!.nodeSize
      if (depth === 0 && index === doc.childCount - 1) return editor.commands.setTextSelection(title)
      return editor.commands.command(({ tr, dispatch }) => {
        if (!dispatch) return true
        tr.delete(block, block + $from.parent.nodeSize)
        tr.setSelection(TextSelection.create(tr.doc, title))
        dispatch(tr.scrollIntoView())
        return true
      })
    }
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(doc, at)).scrollIntoView())
    return true
  }
  // Open: a paragraph's text joins its last line; anything else (code, a quote) is left to the editor.
  const last = previous.lastChild!
  if (depth !== $from.depth - 1 || $from.parent.type.name !== 'paragraph' || !last.isTextblock || last.type.spec.code) return false
  const target = block - 2
  return editor.commands.command(({ tr, dispatch }) => {
    if (!dispatch) return true
    tr.replace(target, $from.after(), new Slice($from.parent.content, 0, 0))
    tr.setSelection(TextSelection.create(tr.doc, target))
    dispatch(tr.scrollIntoView())
    return true
  })
}

/**
 * Where a file goes when the cursor (or a drop) is in a toggle's title, which holds only text, or
 * right before it: under the title if the toggle is open. In a closed toggle, where it would be
 * hidden: after the toggle (the outermost closed one). Anywhere else, where it was.
 */
export function outOfTitle(doc: PMNode, pos: number) {
  const $pos = doc.resolve(pos)
  let at = pos
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth)
    if (node.type.name !== 'toggle') continue
    const start = $pos.before(depth)
    if (!node.attrs.open) at = start + node.nodeSize
    else if (at === pos && $pos.index(depth) === 0) at = start + 1 + node.firstChild!.nodeSize
  }
  return at
}

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

/**
 * Puts a new toggle in place of the empty line with the cursor, or after its block where one can go,
 * with the cursor in its title. Not in a table's cell, whose Markdown is a line, nor in a title.
 */
export function insertToggle(tr: Transaction) {
  const { $from } = tr.selection
  const type = tr.doc.type.schema.nodes.toggle!
  for (let depth = $from.depth; depth > 0; depth--) if (String($from.node(depth).type.spec.tableRole ?? '').endsWith('cell')) return false
  if ($from.parent.type.name === 'toggleTitle') return false
  const toggle = newToggle(tr.doc.type.schema)
  if ($from.parent.isTextblock && $from.parent.content.size === 0 && $from.depth > 0) {
    const index = $from.index($from.depth - 1)
    if ($from.node($from.depth - 1).canReplaceWith(index, index + 1, type)) {
      const at = $from.before()
      tr.replaceWith(at, at + $from.parent.nodeSize, toggle)
      tr.setSelection(TextSelection.create(tr.doc, at + 2))
      return true
    }
  }
  for (let depth = $from.depth; depth > 0; depth--) {
    const at = $from.after(depth)
    const $at = tr.doc.resolve(at)
    if (!$at.parent.canReplaceWith($at.index(), $at.index(), type)) continue
    tr.insert(at, toggle)
    tr.setSelection(TextSelection.create(tr.doc, at + 2))
    return true
  }
  return false
}
