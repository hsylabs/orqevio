import type { Editor } from '@tiptap/core'
import CodeBlockLowlight, { type CodeBlockLowlightOptions } from '@tiptap/extension-code-block-lowlight'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type NodeView } from '@tiptap/pm/view'
import i18next, { t } from 'i18next'
import { copyText } from '../../../components/ui/CopyButton'
import { codeColoursLoaded, findLanguage, highlighter, languageOf, loadCodeColours, PLAIN, whenCodeColoursLoad } from './code-languages'
import { readPending } from './own-step'
import { icon } from './svg-icons'

/** What the editor's controls reach through `editor.storage.codeBlock`. */
export interface CodeBlockStorage {
  /** Opens the list of languages of the block at `pos` (CodeControls). */
  openLanguages: ((pos: number) => void) | null
  /** Whether the colours were there when the editor began; if not, it is redrawn once they arrive. */
  colouredAtStart: boolean
  stopWaiting: (() => void) | null
}

export const codeStorage = (editor: Editor) => (editor.storage as unknown as { codeBlock?: CodeBlockStorage }).codeBlock

/** A block's language as people read it: its name, the word written when the list doesn't know it, or none. */
export function languageName(info: string | null | undefined) {
  const word = languageOf(info)
  if (!word) return ''
  if (PLAIN.has(word.toLowerCase())) return t('docs:editor.code.plain')
  return findLanguage(word)?.name ?? word
}

/** A class for the code of a block: its language's first word if it can be one, never the rest of its line. */
export const languageClass = (info: string | null | undefined) => {
  const word = languageOf(info)
  return /^[\w#+.-]+$/.test(word) ? `language-${word}` : ''
}

/** Copies a block's code, as it is, and says so. */
export const copyCode = (code: string) => copyText(code, { message: t('docs:editor.code.copied') })

// ── The block as shown ───────────────────────────────────────────

/**
 * A code block in the editor: its code, and a bar above it with its language (a button that opens
 * the list of languages) and a button that copies the code. The bar is no part of the document: it
 * is never selected, edited, copied with the text or saved.
 */
class CodeBlockView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private bar: HTMLElement
  private language: HTMLButtonElement
  private name: HTMLSpanElement
  private copy: HTMLButtonElement
  private done: ReturnType<typeof setTimeout> | undefined

  constructor(
    private node: PMNode,
    private editor: Editor,
    private getPos: () => number | undefined,
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'orq-code'
    this.bar = document.createElement('div')
    this.bar.className = 'orq-code-bar'
    this.bar.contentEditable = 'false'
    this.language = document.createElement('button')
    this.language.type = 'button'
    this.language.className = 'orq-code-lang'
    this.language.setAttribute('aria-haspopup', 'dialog')
    this.language.setAttribute('aria-expanded', 'false')
    this.name = document.createElement('span')
    this.language.append(this.name, icon('chevron', 'orq-code-chevron'))
    this.copy = document.createElement('button')
    this.copy.type = 'button'
    this.copy.className = 'orq-code-copy'
    this.copy.append(icon('copy', 'orq-code-icon'), icon('check', 'orq-code-icon orq-code-icon--done'))
    this.bar.append(this.language, this.copy)
    const pre = document.createElement('pre')
    this.contentDOM = document.createElement('code')
    pre.append(this.contentDOM)
    this.dom.append(this.bar, pre)

    // A press on the bar leaves the cursor and the focus where they were, in the editor.
    for (const button of [this.language, this.copy]) button.addEventListener('mousedown', (event) => event.preventDefault())
    this.language.addEventListener('click', () => {
      const pos = this.getPos()
      if (pos !== undefined && this.editor.isEditable) codeStorage(this.editor)?.openLanguages?.(pos)
    })
    this.copy.addEventListener('click', async () => {
      if (!(await copyCode(this.node.textContent))) return
      clearTimeout(this.done)
      this.copy.classList.add('is-done')
      this.done = setTimeout(() => this.copy.classList.remove('is-done'), 1400)
    })
    i18next.on('languageChanged', this.render)
    this.render()
  }

  private render = () => {
    const info = this.node.attrs.language as string | null
    const name = languageName(info)
    this.dom.toggleAttribute('data-plain', !name)
    this.name.textContent = name || t('docs:editor.code.plain')
    this.language.setAttribute('aria-label', t('docs:editor.code.language', { name: this.name.textContent }))
    this.copy.setAttribute('aria-label', t('docs:editor.code.copy'))
    this.copy.title = t('docs:editor.code.copy')
    const className = languageClass(info)
    if (className) this.contentDOM.className = className
    else this.contentDOM.removeAttribute('class')
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    const relabel = node.attrs.language !== this.node.attrs.language
    this.node = node
    if (relabel) this.render()
    return true
  }

  // The bar's buttons are its own: the editor neither selects nor reads anything there.
  stopEvent(event: Event) {
    return event.target instanceof Node && this.bar.contains(event.target)
  }

  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }) {
    return this.bar.contains(mutation.target)
  }

  destroy() {
    clearTimeout(this.done)
    i18next.off('languageChanged', this.render)
  }
}

/** The block with the cursor shows its bar's buttons, as the one under the pointer does. */
const currentCode = (name: string) =>
  new Plugin({
    key: new PluginKey('currentCodeBlock'),
    props: {
      decorations(state) {
        const { $head } = state.selection
        for (let depth = $head.depth; depth > 0; depth--) {
          const node = $head.node(depth)
          if (node.type.name !== name) continue
          const pos = $head.before(depth)
          return DecorationSet.create(state.doc, [Decoration.node(pos, pos + node.nodeSize, { class: 'orq-code--current' })])
        }
        return DecorationSet.empty
      },
    },
  })

/** Draws the code blocks again, with the colours that weren't there yet. Not a change: it isn't saved or undone. */
function redraw(editor: Editor, name: string) {
  if (editor.isDestroyed) return
  // A click or a key the editor hasn't read yet goes first: drawn again before it, the cursor would
  // go back to where it was.
  readPending(editor)
  const { tr, selection } = editor.state
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === name) tr.setNodeMarkup(pos, undefined, node.attrs)
    return !node.isTextblock
  })
  if (!tr.docChanged) return
  // A block selected whole (its menu is open) stays selected: nothing moved.
  if (selection instanceof NodeSelection) tr.setSelection(NodeSelection.create(tr.doc, selection.from))
  editor.view.dispatch(tr.setMeta('addToHistory', false))
}

/** A fence longer than any run of its character that starts a line of the code, as CommonMark has it. */
const fenceFor = (code: string, char: '`' | '~') =>
  char.repeat(Math.max(3, ...[...code.matchAll(char === '`' ? /^ {0,3}(`{3,})/gm : /^ {0,3}(~{3,})/gm)].map((m) => m[1]!.length + 1)))

export const FaithfulCodeBlock = CodeBlockLowlight.extend<CodeBlockLowlightOptions, CodeBlockStorage>({
  addStorage() {
    return { openLanguages: null, colouredAtStart: false, stopWaiting: null }
  },
  // A fence one to three spaces in is a fence, as CommonMark has it (marked gives its code without
  // them): @tiptap/extension-code-block 3.33.0 reads only one at the margin, and lost the code.
  parseMarkdown(token, helpers) {
    const raw = typeof token.raw === 'string' ? token.raw.replace(/^ {1,3}(?=`{3}|~{3})/, '') : token.raw
    return this.parent?.({ ...token, raw }, helpers) ?? []
  },
  // A block showing a fence (Markdown about Markdown, say) keeps it inside: a fence of three would
  // close the block there, and everything after it would become code. An info string with a backtick
  // takes a fence of tildes, as it came: after backticks it would be no fence, and the block text.
  renderMarkdown: (node, helpers) => {
    const language = String(node.attrs?.language ?? '')
    const code = node.content ? helpers.renderChildren(node.content) : ''
    const fence = fenceFor(code, language.includes('`') ? '~' : '`')
    return `${fence}${language}\n${code}\n${fence}`
  },
  addNodeView() {
    return ({ node, editor, getPos }) => new CodeBlockView(node, editor, getPos)
  },
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), currentCode(this.name)]
  },
  onBeforeCreate() {
    this.storage.colouredAtStart = codeColoursLoaded()
    void loadCodeColours()
  },
  onCreate() {
    if (!this.storage.colouredAtStart) this.storage.stopWaiting = whenCodeColoursLoad(() => redraw(this.editor, this.name))
  },
  onDestroy() {
    this.storage.stopWaiting?.()
  },
}).configure({ lowlight: highlighter, defaultLanguage: null })
