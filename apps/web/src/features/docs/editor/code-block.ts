import type { Editor } from '@tiptap/core'
import CodeBlockLowlight, { type CodeBlockLowlightOptions } from '@tiptap/extension-code-block-lowlight'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type NodeView } from '@tiptap/pm/view'
import i18next, { t } from 'i18next'
import { copyText } from '../../../components/ui/CopyButton'
import { codeColoursLoaded, findLanguage, highlighter, languageOf, loadCodeColours, PLAIN, whenCodeColoursLoad } from './code-languages'
import { type Drawing, diagramLink, drawDiagram, drawnBefore, isDiagram, markDrawn, onThemeChange, showDrawing } from './diagram'
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
  // Drawn rather than coloured (diagram.ts).
  if (isDiagram(word)) return 'Mermaid'
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
/** How a diagram is shown: its drawing (its code too while the cursor is in it), its code, or both. */
type DiagramView = 'diagram' | 'code' | 'both'
const DIAGRAM_VIEWS: DiagramView[] = ['diagram', 'code', 'both']
const VIEW_LABELS = { diagram: 'docs:editor.diagram.diagram', code: 'docs:editor.diagram.code', both: 'docs:editor.diagram.both' } as const

class CodeBlockView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private bar: HTMLElement
  private language: HTMLButtonElement
  private name: HTMLSpanElement
  private copy: HTMLButtonElement
  private done: ReturnType<typeof setTimeout> | undefined
  /** For a diagram: its drawing, how it is shown, and what was drawn last. */
  private diagram: { box: HTMLElement; views: HTMLElement; view: DiagramView; drawn: string | null; request: number; timer?: ReturnType<typeof setTimeout>; stop: () => void } | null = null

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
    if (isDiagram(node.attrs.language as string | null)) this.startDiagram()

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
    if (this.diagram) {
      this.diagram.views.setAttribute('aria-label', t('docs:editor.diagram.views'))
      for (const button of this.diagram.views.querySelectorAll<HTMLButtonElement>('button')) button.textContent = t(VIEW_LABELS[button.dataset.view as DiagramView])
      if (!this.node.textContent.trim()) this.diagram.box.textContent = t('docs:editor.diagram.empty')
    }
  }

  /** A diagram: a switch in its bar between its drawing, its code or both, and its drawing under its code. */
  private startDiagram() {
    const views = document.createElement('div')
    views.className = 'orq-diagram-views'
    views.setAttribute('role', 'group')
    for (const view of DIAGRAM_VIEWS) {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.view = view
      button.addEventListener('mousedown', (event) => event.preventDefault())
      button.addEventListener('click', () => this.showAs(view))
      views.append(button)
    }
    this.bar.insertBefore(views, this.copy)
    const box = document.createElement('div')
    box.className = 'orq-diagram'
    box.contentEditable = 'false'
    // A press on the drawing puts the cursor at the end of its code, which shows with it. A link in it
    // leads nowhere, unless with Ctrl (⌘), in a new tab.
    box.addEventListener('mousedown', (event) => event.preventDefault())
    box.addEventListener('click', (event) => {
      if (diagramLink(event) && (event.metaKey || event.ctrlKey)) return
      const pos = this.getPos()
      if (pos === undefined || !this.editor.isEditable) return
      this.editor.chain().focus().setTextSelection(pos + this.node.nodeSize - 1).run()
    })
    this.dom.append(box)
    this.dom.setAttribute('data-diagram', '')
    this.diagram = { box, views, view: 'diagram', drawn: null, request: 0, stop: onThemeChange(() => this.redraw(0, true)) }
    // Drawn before (the page opened again): shown at once.
    const before = drawnBefore(this.node.textContent)
    if (before && this.node.textContent.trim()) {
      markDrawn(this.dom, showDrawing(box, before))
      this.diagram.drawn = this.node.textContent
    }
    this.showAs('diagram')
  }

  private showAs(view: DiagramView) {
    if (!this.diagram) return
    this.diagram.view = view
    this.dom.dataset.view = view
    for (const button of this.diagram.views.querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String(button.dataset.view === view))
    this.redraw(0)
  }

  /** Draws the diagram again in `wait` ms, unless what it would draw is what it shows (`again`: it is anyway). */
  private redraw(wait: number, again = false) {
    const diagram = this.diagram
    if (!diagram) return
    clearTimeout(diagram.timer)
    if (again) diagram.drawn = null
    // Its code alone shows: drawn once it is to be seen.
    if (diagram.view === 'code') return
    diagram.timer = setTimeout(async () => {
      const code = this.node.textContent
      if (code === diagram.drawn) return
      diagram.drawn = code
      const request = ++diagram.request
      if (!code.trim()) {
        diagram.box.textContent = t('docs:editor.diagram.empty')
        markDrawn(this.dom, null)
        return
      }
      let drawing: Drawing
      try {
        drawing = await drawDiagram(code)
      } catch {
        // Mermaid couldn't be loaded: drawn when the code changes again.
        diagram.drawn = null
        return
      }
      // Something newer is being drawn, or the block is gone.
      if (request !== diagram.request || this.diagram !== diagram) return
      markDrawn(this.dom, showDrawing(diagram.box, drawing))
    }, wait)
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    // Becoming a diagram or no longer one: drawn anew.
    if (isDiagram(node.attrs.language as string | null) !== !!this.diagram) return false
    const relabel = node.attrs.language !== this.node.attrs.language
    const changed = node.textContent !== this.node.textContent
    this.node = node
    if (relabel) this.render()
    // While it is typed, once a pause comes.
    if (changed) this.redraw(400)
    return true
  }

  // The bar's buttons and the drawing are its own: the editor neither selects nor reads anything there.
  // A file dropped on the drawing is the editor's, as anywhere else on the page.
  stopEvent(event: Event) {
    if (!(event.target instanceof Node)) return false
    if (this.bar.contains(event.target)) return true
    return !!this.diagram?.box.contains(event.target) && !event.type.startsWith('drag') && event.type !== 'drop'
  }

  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }) {
    if (this.bar.contains(mutation.target) || this.diagram?.box.contains(mutation.target)) return true
    // How it is shown (its view, a drawing that couldn't be made) is its own too.
    return mutation.type === 'attributes' && mutation.target === this.dom && mutation.attributeName !== 'class'
  }

  destroy() {
    clearTimeout(this.done)
    i18next.off('languageChanged', this.render)
    if (this.diagram) {
      clearTimeout(this.diagram.timer)
      this.diagram.stop()
      this.diagram = null
    }
  }
}

/**
 * The block with the cursor shows its bar's buttons, as the one under the pointer does; a selection
 * that starts or ends in one, too (a diagram's code shows while it is selected).
 */
const currentCode = (name: string) =>
  new Plugin({
    key: new PluginKey('currentCodeBlock'),
    props: {
      decorations(state) {
        const found = new Map<number, Decoration>()
        for (const $pos of [state.selection.$head, state.selection.$anchor]) {
          for (let depth = $pos.depth; depth > 0; depth--) {
            const node = $pos.node(depth)
            if (node.type.name !== name) continue
            const pos = $pos.before(depth)
            found.set(pos, Decoration.node(pos, pos + node.nodeSize, { class: 'orq-code--current' }))
            break
          }
        }
        return found.size ? DecorationSet.create(state.doc, [...found.values()]) : DecorationSet.empty
      },
      // ↑ and ↓ from the line next to a diagram go into its code, which the browser can't when it is hidden.
      handleKeyDown(view, event) {
        if ((event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false
        const down = event.key === 'ArrowDown'
        const { selection } = view.state
        if (!selection.empty || !selection.$head.parent.isTextblock || !view.endOfTextblock(down ? 'down' : 'up')) return false
        // A toggle's title and what it holds are the toggle's own to go between (toggle.ts).
        if (selection.$head.parent.type.name === 'toggleTitle') return false
        const $edge = view.state.doc.resolve(down ? selection.$head.after() : selection.$head.before())
        const next = down ? $edge.nodeAfter : $edge.nodeBefore
        if (next?.type.name !== name || !isDiagram(next.attrs.language as string | null)) return false
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, down ? $edge.pos + 1 : $edge.pos - 1)).scrollIntoView())
        return true
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
