import { type Editor, Extension, type Range } from '@tiptap/core'
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { NodeView } from '@tiptap/pm/view'
import { t } from 'i18next'
import katex, { type KatexOptions } from 'katex'
import 'katex/dist/katex.min.css'
import { ownStep, readPending } from './own-step'

/**
 * Formulas, as in Notion: in a line of text or as a block of their own, written in LaTeX and drawn
 * with KaTeX, on TipTap's own mathematics extension. Saved as GitHub reads them: `$…$` in a line,
 * `$$…$$` on lines of their own, and a fence of the language `math`; each one as it was written.
 */

// ── Markdown ─────────────────────────────────────────────────────

const SPACE = /\s/
const DIGIT = /\d/

export type MathSource = { raw: string; latex: string }

/** Where the paragraph `src` is in at `from` ends: a formula never reaches past a blank line. */
function paragraphEnd(src: string, from: number) {
  const blank = /\n[ \t]*(?:\n|$)/g
  blank.lastIndex = from
  return blank.exec(src)?.index ?? src.length
}

/**
 * A formula in a line, at `from` in `src`: GitHub's $`…`$, for one with characters Markdown would
 * read, or `$…$` as Pandoc has it, so that prices are no formulas (`$5 y $10`): no space after the
 * first `$`, none before the next one, and no digit right after it; if the next `$` can't end it,
 * there is none (`$5 por $x$` is a price and a formula). A `\` takes the character after it: `\$` is
 * a dollar in the formula.
 */
export function readInlineMath(src: string, from = 0): MathSource | null {
  if (src[from] !== '$') return null
  const end = paragraphEnd(src, from)
  // `$$…$$` in a line, as the editor makes it as it is typed (TipTap's own rule, as in Notion).
  if (src[from + 1] === '$') {
    const close = src.indexOf('$$', from + 2)
    if (close === -1 || close + 2 > end || src[close + 2] === '$') return null
    const latex = src.slice(from + 2, close)
    return latex.trim() && !latex.includes('\n') ? { raw: src.slice(from, close + 2), latex } : null
  }
  if (src[from + 1] === '`') {
    const close = src.indexOf('`$', from + 2)
    if (close > from + 2 && close + 2 <= end) return { raw: src.slice(from, close + 2), latex: src.slice(from + 2, close) }
  }
  const first = src[from + 1]
  if (first === undefined || first === '$' || SPACE.test(first)) return null
  for (let i = from + 1; i < end; i++) {
    const char = src[i]
    if (char === '\\') {
      i++
      continue
    }
    if (char !== '$') continue
    if (SPACE.test(src[i - 1]!) || DIGIT.test(src[i + 1] ?? '')) return null
    return { raw: src.slice(from, i + 1), latex: src.slice(from + 1, i) }
  }
  return null
}

const DOLLARS_LINE = /^ {0,3}\$\$[ \t]*$/
const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})[ \t]*math[ \t]*$/

/**
 * A formula as a block at the start of `src`: `$$` on a line of its own, the formula, and `$$` on a
 * line of its own; all of it on one line (`$$…$$`); or a fence of the language `math`. Between `$$`,
 * no blank line, where Markdown ends a paragraph. Never empty.
 */
export function readBlockMath(src: string): MathSource | null {
  // Line after line, only as far as the formula goes: asked at every block of the document.
  const lines: string[] = []
  let at = 0
  const next = () => {
    if (at > src.length) return null
    const end = src.indexOf('\n', at)
    const line = src.slice(at, end === -1 ? src.length : end)
    at = end === -1 ? src.length + 1 : end + 1
    lines.push(line)
    return line
  }
  const first = next()!
  const fence = FENCE_OPEN.exec(first)
  if (fence) {
    const [, indent, open] = fence
    for (let line = next(); line !== null; line = next()) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
      if (!close || close[1]![0] !== open![0] || close[1]!.length < open!.length) continue
      const latex = lines
        .slice(1, -1)
        .map((text) => text.replace(new RegExp(`^ {0,${indent!.length}}`), ''))
        .join('\n')
      return latex.trim() ? { raw: lines.join('\n'), latex } : null
    }
    return null
  }
  const one = /^ {0,3}\$\$(?!\$)(.*\S.*?)\$\$[ \t]*$/.exec(first)
  if (one) return { raw: first, latex: one[1]! }
  if (!DOLLARS_LINE.test(first)) return null
  for (let line = next(); line !== null; line = next()) {
    if (!line.trim()) return null
    if (!DOLLARS_LINE.test(line)) continue
    return lines.length > 2 ? { raw: lines.join('\n'), latex: lines.slice(1, -1).join('\n') } : null
  }
  return null
}

/**
 * Where a formula of its own starts on a line of the paragraph `src` is in, or -1: there it breaks
 * the paragraph, as a fence does (in a list's item, the formula is on the line after its text).
 * marked asks from the paragraph's second character: only what follows a line break starts a line.
 */
export function blockMathStart(src: string) {
  const end = paragraphEnd(src, 0)
  const line = /\n( {0,3}(?:\$\$|`{3,}|~{3,}))/g
  for (let match = line.exec(src); match && match.index < end; match = line.exec(src)) {
    const at = match.index + match[0].length - match[1]!.length
    if (readBlockMath(src.slice(at)) !== null) return at
  }
  return -1
}

/**
 * A formula's source as it is kept: one in a line on one line, where a line break would end a
 * heading or a table's row, and one of its own without blank lines, where `$$` would end.
 */
export function tidyLatex(latex: string, display: boolean) {
  if (!display) return latex.replace(/\s*\n\s*/g, ' ').trim()
  return latex
    .replace(/\r\n?/g, '\n')
    .replace(/\n(?:[ \t]*\n)+/g, '\n')
    .replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, '')
}

/** A formula in a line as Markdown: as it was written, or `$…$`, or $`…`$ when that wouldn't read back. */
export function inlineMathMarkdown(latex: string, raw: string | null) {
  if (!latex.trim()) return ''
  const reads = (markdown: string) => {
    const read = readInlineMath(markdown)
    return read?.raw === markdown && read.latex === latex
  }
  if (raw && reads(raw)) return raw
  const candidates = [...(raw?.startsWith('$$') ? [`$$${latex}$$`] : []), `$${latex}$`, `$\`${latex}\`$`]
  return candidates.find(reads) ?? candidates[0]!
}

/** A fence longer than any run of its character that starts a line of the formula. */
function fenceFor(latex: string, char: string) {
  const runs = [...latex.matchAll(char === '`' ? /^ {0,3}(`{3,})/gm : /^ {0,3}(~{3,})/gm)].map((m) => m[1]!.length + 1)
  return char.repeat(Math.max(3, ...runs))
}

/** A formula of its own as Markdown: as it was written, or in its form (fence, one line, `$$` lines) with the new source. */
export function blockMathMarkdown(latex: string, raw: string | null) {
  if (!latex.trim()) return ''
  const reads = (markdown: string) => {
    const read = readBlockMath(markdown)
    return read?.raw === markdown && read.latex === latex
  }
  if (raw && reads(raw)) return raw
  const fence = raw ? FENCE_OPEN.exec(raw.split('\n')[0]!) : null
  const fenced = (char: string) => {
    const mark = fenceFor(latex, char)
    return `${mark}math\n${latex}\n${mark}`
  }
  const candidates = [
    ...(fence ? [fenced(fence[2]![0]!)] : []),
    ...(raw && !raw.includes('\n') && !latex.includes('\n') ? [`$$${latex}$$`] : []),
    `$$\n${latex}\n$$`,
    fenced('`'),
  ]
  return candidates.find(reads) ?? candidates.at(-1)!
}

// What a `$` of text reads as depends on what comes after it, which text alone doesn't know: it
// is marked where text is written, and settled once its paragraph or heading is.

/** Before a `$` of text. */
const DOLLAR = '﷐'
/** Around a formula in a line. */
const OPEN = '﷑'
const CLOSE = '﷒'
const MARKS = /[﷐-﷒]/g

/** Text as Markdown writes it, with each of its `$` marked for settleDollars. */
export const markDollars = (markdown: string) => (markdown.includes('$') ? markdown.replace(/\$/g, () => `${DOLLAR}$`) : markdown)

/** A formula in a line, marked for settleDollars. */
const markFormula = (markdown: string) => (markdown ? `${OPEN}${markdown}${CLOSE}` : '')

/** A formula in a line as Markdown writes it, marked for settleDollars. */
export const inlineFormula = (attrs: Record<string, unknown> | undefined) => markFormula(inlineMathMarkdown(String(attrs?.latex ?? ''), (attrs?.raw as string | null) ?? null))

/**
 * The marked `$` of a paragraph's or a heading's Markdown, written so it reads back as it is: a `$`
 * of text that would open a formula is escaped, and so is one that would open a formula of its own
 * at the start of the block; any other stays as it was. A formula followed by a digit is written as
 * $`…`$, which ends before it. From the end: what each one reads as depends only on what follows.
 */
export function settleDollars(markdown: string) {
  if (!markdown.match(MARKS)) return markdown
  const parts: string[] = []
  const after = () => parts.slice().reverse().join('')
  let end = markdown.length
  for (let i = markdown.length - 1; i >= 0; i--) {
    const char = markdown[i]
    if (char === CLOSE) {
      const open = markdown.lastIndexOf(OPEN, i)
      parts.push(markdown.slice(i + 1, end))
      const formula = markdown.slice(open + 1, i).replace(MARKS, '')
      const next = after()[0] ?? ''
      parts.push(formula[1] !== '`' && DIGIT.test(next) && !formula.includes('`$') ? `$\`${formula.slice(1, -1)}\`$` : formula)
      i = open
      end = open
    } else if (char === DOLLAR && markdown[i + 1] === '$') {
      parts.push(markdown.slice(i + 2, end))
      const following = `$${after()}`
      const start = markdown.slice(0, i).replace(MARKS, '')
      // At the start of any of its lines: a formula of its own breaks a paragraph there.
      const opens = readInlineMath(following) !== null || (/(?:^|\n)[ \t]*$/.test(start) && readBlockMath(following) !== null)
      parts.push(opens ? '\\$' : '$')
      end = i
    }
  }
  parts.push(markdown.slice(0, end))
  return parts.reverse().join('').replace(MARKS, '')
}

// ── How they look ────────────────────────────────────────────────

/**
 * KaTeX as it is safe for a page anyone in the workspace (or an agent) wrote: no links, classes or
 * other HTML from the formula (`trust`), and sizes and macros kept small enough to draw.
 */
const KATEX: KatexOptions = { throwOnError: true, strict: 'ignore', trust: false, maxSize: 40, maxExpand: 1000, output: 'htmlAndMathml' }

/** Draws a formula into `box`: as KaTeX does, or its source if it can't, saying why; an empty one says so. */
export function drawMath(box: HTMLElement, latex: string, display: boolean) {
  box.classList.remove('orq-math--error', 'orq-math--empty')
  box.removeAttribute('title')
  if (!latex.trim()) {
    box.textContent = t('docs:editor.math.empty')
    box.classList.add('orq-math--empty')
    return
  }
  try {
    katex.render(latex, box, { ...KATEX, displayMode: display })
  } catch (error) {
    box.textContent = latex
    box.classList.add('orq-math--error')
    box.title = `${t('docs:editor.math.error')}: ${error instanceof Error ? error.message.replace(/^KaTeX parse error: /, '') : String(error)}`
  }
}

/** Whether KaTeX can draw it, and if not, why (for the field where it is written). */
export function mathError(latex: string, display: boolean): string | null {
  try {
    katex.renderToString(latex, { ...KATEX, displayMode: display })
    return null
  } catch (error) {
    return error instanceof Error ? error.message.replace(/^KaTeX parse error: /, '') : String(error)
  }
}

/** What the editor's controls reach through `editor.storage.inlineMath`. */
export interface MathStorage {
  /** Opens the field where the formula at `pos` is written (MathControls). */
  edit: ((pos: number) => void) | null
  /** Opens it for a new one, which goes in at `pos` once it has a source. */
  create: ((pos: number, display: boolean) => void) | null
}

export const mathStorage = (editor: Editor) => (editor.storage as unknown as { inlineMath?: MathStorage }).inlineMath

/**
 * A formula in the editor: drawn by KaTeX, never edited in place. A click (a tap on a phone) opens
 * the field where it is written, as Enter does with it selected.
 */
class MathView implements NodeView {
  dom: HTMLElement
  private drawn: string | null = null

  constructor(
    private node: PMNode,
    private editor: Editor,
    private getPos: () => number | undefined,
    private display: boolean,
  ) {
    this.dom = document.createElement(display ? 'div' : 'span')
    this.dom.className = display ? 'orq-math orq-math--block' : 'orq-math'
    this.dom.dataset.type = display ? 'block-math' : 'inline-math'
    this.dom.addEventListener('click', this.open)
    this.draw()
  }

  private open = (event: MouseEvent) => {
    const pos = this.getPos()
    if (pos === undefined || !this.editor.isEditable) return
    event.preventDefault()
    mathStorage(this.editor)?.edit?.(pos)
  }

  private draw() {
    const latex = String(this.node.attrs.latex ?? '')
    if (latex === this.drawn) return
    this.drawn = latex
    this.dom.setAttribute('data-latex', latex)
    drawMath(this.dom, latex, this.display)
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    this.draw()
    return true
  }

  // What KaTeX draws is no part of the document.
  ignoreMutation() {
    return true
  }

  destroy() {
    this.dom.removeEventListener('click', this.open)
  }
}

// ── The nodes ────────────────────────────────────────────────────

/** The TeX source KaTeX and MathJax keep in what they draw: pasted from a page, it is the formula's. */
const texOf = (element: HTMLElement) => element.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim() ?? ''
/** Only what keeps its TeX source is a formula; what doesn't is read as what it holds. */
const withTex = (element: HTMLElement) => (texOf(element) ? null : false)

/**
 * Its source, ours or the one kept in what KaTeX or MathJax drew, and the Markdown it was read
 * from: written back as it was while the source is the same.
 */
const sourceAttributes = () => ({
  latex: {
    default: '',
    parseHTML: (element: HTMLElement) => element.getAttribute('data-latex') ?? texOf(element),
    renderHTML: (attributes: Record<string, unknown>) => ({ 'data-latex': String(attributes.latex ?? '') }),
  },
  raw: { default: null, rendered: false },
})

/** A formula in a line of text; bold, in italics, struck or in a link, as text is (not code). */
export const FaithfulInlineMath = InlineMath.extend<object, MathStorage>({
  marks: 'bold italic strike link',
  addStorage() {
    return { edit: null, create: null }
  },
  addAttributes() {
    return sourceAttributes()
  },
  parseHTML() {
    return [
      ...(this.parent?.() ?? []),
      // Pasted from a page that draws its formulas with KaTeX, or with MathML (MathJax, Wikipedia).
      { tag: 'span.katex', getAttrs: withTex },
      { tag: 'math:not([display="block"])', getAttrs: withTex },
    ]
  },
  renderText: ({ node }) => `$${String(node.attrs.latex ?? '')}$`,
  markdownTokenizer: {
    name: 'inlineMath',
    level: 'inline',
    start: (src: string) => src.indexOf('$'),
    tokenize: (src: string) => {
      const read = readInlineMath(src)
      return read ? { type: 'inlineMath', ...read } : undefined
    },
  },
  parseMarkdown: (token) => ({ type: 'inlineMath', attrs: { latex: String(token.latex ?? ''), raw: String(token.raw ?? '') } }),
  // Written as text is, in its marks' run (markdown.ts); this is for one written on its own.
  renderMarkdown: (node) => inlineFormula(node.attrs),
  addNodeView() {
    return ({ node, editor, getPos }) => new MathView(node, editor, getPos, false)
  },
})

/** A formula of its own, between blocks. */
export const FaithfulBlockMath = BlockMath.extend({
  addAttributes() {
    return sourceAttributes()
  },
  parseHTML() {
    return [
      ...(this.parent?.() ?? []),
      { tag: '.katex-display', getAttrs: withTex },
      { tag: 'math[display="block"]', getAttrs: withTex },
    ]
  },
  renderText: ({ node }) => `$$\n${String(node.attrs.latex ?? '')}\n$$`,
  markdownTokenizer: {
    name: 'blockMath',
    level: 'block',
    // Asked at every paragraph with the rest of the document: only the paragraph matters.
    start: (src: string) => blockMathStart(src),
    tokenize: (src: string) => {
      const read = readBlockMath(src)
      return read ? { type: 'blockMath', ...read } : undefined
    },
  },
  parseMarkdown: (token) => ({ type: 'blockMath', attrs: { latex: String(token.latex ?? ''), raw: String(token.raw ?? '') } }),
  renderMarkdown: (node) => blockMathMarkdown(String(node.attrs?.latex ?? ''), (node.attrs?.raw as string | null) ?? null),
  addNodeView() {
    return ({ node, editor, getPos }) => new MathView(node, editor, getPos, true)
  },
})

// ── Changes ──────────────────────────────────────────────────────

const isMath = (node: PMNode | null | undefined) => node?.type.name === 'inlineMath' || node?.type.name === 'blockMath'

/**
 * The formula at `pos` with another source, as a step of its own; with none, the formula goes. The
 * cursor goes after a formula in a line, where typing doesn't replace it; one of its own stays selected.
 */
export function setMath(editor: Editor, pos: number, source: string, { focus = true } = {}) {
  const node = editor.state.doc.nodeAt(pos)
  if (!node || !isMath(node)) return false
  const display = node.type.name === 'blockMath'
  // Left as it was, nothing changes, nor how it was written.
  const latex = source === node.attrs.latex ? source : tidyLatex(source, display)
  if (latex === node.attrs.latex) return focus ? placeAfter(editor, pos) : false
  return ownStep(
    editor,
    ({ tr }) => {
      if (!latex.trim()) {
        tr.delete(pos, pos + node.nodeSize)
        return true
      }
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex })
      tr.setSelection(display ? NodeSelection.create(tr.doc, pos) : TextSelection.create(tr.doc, pos + node.nodeSize))
      return true
    },
    { focus },
  )
}

/** Back to the editor right after a formula in a line, or with one of its own selected: nothing changed. */
export function placeAfter(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos)
  if (!node || !isMath(node)) return false
  const display = node.type.name === 'blockMath'
  const { tr } = editor.state
  tr.setSelection(display ? NodeSelection.create(tr.doc, pos) : TextSelection.create(tr.doc, pos + node.nodeSize))
  editor.view.dispatch(tr.setMeta('addToHistory', false))
  editor.commands.focus(undefined, { scrollIntoView: false })
  return true
}

/**
 * A new formula with its source, at `pos`, as one step: in a line there; of its own instead of an
 * empty line, or else after the block the line is in, splitting it at `pos`.
 */
export function insertMath(editor: Editor, pos: number, source: string, display: boolean, { focus = true } = {}) {
  const latex = tidyLatex(source, display)
  if (!latex.trim()) return false
  return ownStep(
    editor,
    ({ tr, state }) => {
    const at = Math.min(pos, tr.doc.content.size)
    if (!display) {
      const node = state.schema.nodes.inlineMath!.create({ latex })
      tr.insert(at, node)
      tr.setSelection(TextSelection.create(tr.doc, at + node.nodeSize))
      return true
    }
    const node = state.schema.nodes.blockMath!.create({ latex })
    const $at = tr.doc.resolve(at)
    const empty = $at.parent.isTextblock && $at.parent.content.size === 0 && $at.depth > 0
    if (empty && $at.node(-1).canReplaceWith($at.index(-1), $at.indexAfter(-1), node.type)) {
      const from = $at.before()
      tr.replaceWith(from, $at.after(), node)
      tr.setSelection(NodeSelection.create(tr.doc, from))
      return true
    }
    tr.setSelection(TextSelection.create(tr.doc, at))
    tr.replaceSelectionWith(node)
    const placed = tr.mapping.map(at, -1)
    const found = [placed, placed + 1, placed - 1].find((p) => p >= 0 && p <= tr.doc.content.size && tr.doc.nodeAt(p)?.type.name === 'blockMath')
    if (found !== undefined) tr.setSelection(NodeSelection.create(tr.doc, found))
    return true
    },
    { focus },
  )
}

/** The text selected in one line, plain, which can become the source of a formula. */
export function selectedSource(editor: Editor): { from: number; to: number; text: string } | null {
  const { selection, doc } = editor.state
  if (!(selection instanceof TextSelection) || selection.empty || !selection.$from.sameParent(selection.$to)) return null
  // Not in code, nor in a toggle's title, which hold only text.
  if (selection.$from.parent.type.spec.code) return null
  let plain = true
  doc.nodesBetween(selection.from, selection.to, (node) => {
    if (node.isInline && !node.isText) plain = false
  })
  const text = doc.textBetween(selection.from, selection.to)
  return plain && text.trim() ? { from: selection.from, to: selection.to, text } : null
}

/** The text selected turned into a formula in a line, as Notion does (Ctrl+Shift+E), and its field opened. */
export function selectionToMath(editor: Editor) {
  const source = selectedSource(editor)
  if (!source) return false
  const latex = tidyLatex(source.text, false)
  const done = ownStep(editor, ({ tr, state }) => {
    tr.replaceWith(source.from, source.to, state.schema.nodes.inlineMath!.create({ latex }))
    tr.setSelection(NodeSelection.create(tr.doc, source.from))
    return true
  })
  if (done) mathStorage(editor)?.edit?.(source.from)
  return done
}

/**
 * The keys of formulas: Enter on one selected opens its field (instead of replacing it), and
 * Ctrl+Shift+E (⌘⇧E) makes the text selected one, or opens the field of a new one at the cursor.
 * Each reads first what the browser did just before it (a selection made with Shift+arrows).
 */
export const MathKeys = Extension.create({
  name: 'mathKeys',
  priority: 1000,
  addKeyboardShortcuts() {
    const editor = this.editor
    return {
      Enter: () => {
        const edit = mathStorage(editor)?.edit
        if (!edit) return false
        readPending(editor)
        const { selection } = editor.state
        if (!(selection instanceof NodeSelection) || !isMath(selection.node)) return false
        edit(selection.from)
        return true
      },
      'Mod-Shift-e': () => {
        const create = mathStorage(editor)?.create
        if (!create) return false
        readPending(editor)
        if (selectionToMath(editor)) return true
        const { selection } = editor.state
        if (!selection.empty || selection.$from.parent.type.spec.code || !selection.$from.parent.inlineContent) return false
        create(selection.from, false)
        return true
      },
    }
  },
})

/**
 * A formula from the «/» menu: its field opens where it will go, with `range` (the «/» typed) gone.
 * In a table's cell, which Markdown keeps on one line, a formula of its own is one in the line.
 */
export function startMath(editor: Editor, range: Range, display: boolean) {
  editor.chain().focus().deleteRange(range).run()
  const { $from } = editor.state.selection
  let inTable = false
  for (let depth = $from.depth; depth > 0; depth--) if (['tableCell', 'tableHeader'].includes($from.node(depth).type.name)) inTable = true
  mathStorage(editor)?.create?.($from.pos, display && !inTable)
}
