import { type Editor, Extension, type Range, mergeAttributes } from '@tiptap/core'
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state'
import type { NodeView } from '@tiptap/pm/view'
import { t } from 'i18next'
import katex, { type KatexOptions } from 'katex'
import 'katex/dist/katex.min.css'
import { AUTOLINK, INLINE_HTML } from './inline-html'
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
 * a dollar in the formula. Neither crosses a code span or a link's address, which come first in
 * Markdown: `` `A=$B` `` and `](…?$top=10)` keep their dollars.
 */
export function readInlineMath(src: string, from = 0): MathSource | null {
  if (src[from] !== '$') return null
  const end = paragraphEnd(src, from)
  // `$$…$$` in a line, as the editor makes it as it is typed (TipTap's own rule, as in Notion).
  if (src[from + 1] === '$') {
    const close = src.indexOf('$$', from + 2)
    if (close === -1 || close + 2 > end || src[close + 2] === '$') return null
    const latex = src.slice(from + 2, close)
    return latex.trim() && !/[\n`]|\]\(/.test(latex) ? { raw: src.slice(from, close + 2), latex } : null
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
    if (char === '`' || (char === ']' && src[i + 1] === '(')) return null
    // An autolink or raw HTML, as CommonMark has them (`a<b` is neither): `<https://…?$top>`, `<span>…`.
    if (char === '<' && (AUTOLINK.test(src.slice(i, end)) || INLINE_HTML.test(src.slice(i, end)))) return null
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
 * line of its own; all of it alone on one line (`$$…$$`, not two of them); or a fence of the language
 * `math`. Between `$$`, no blank line, where Markdown ends a paragraph. Never empty.
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
  const lead = /^ {0,3}\$\$/.exec(first)?.[0].length
  if (lead !== undefined && first[lead] !== '$') {
    const close = first.indexOf('$$', lead)
    const latex = close === -1 ? '' : first.slice(lead, close)
    if (latex.trim() && !first.slice(close + 2).trim()) return { raw: first, latex }
  }
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
 * Asked at every paragraph with the rest of the document: only the paragraph matters.
 */
export function blockMathStart(src: string) {
  const paragraph = src.slice(0, paragraphEnd(src, 0))
  const line = /\n( {0,3}(?:\$\$|`{3,}|~{3,}))/g
  for (let match = line.exec(paragraph); match; match = line.exec(paragraph)) {
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

/** A formula in a line, and what is around it where it is written. */
export interface InlineFormula {
  latex: string
  /** The Markdown it was read from, if any. */
  raw: string | null
  /** In a heading or a table, which end at a line break. */
  oneLine?: boolean
  /** In a table, whose cells unescape `\|` before reading what they hold. */
  inTable?: boolean
  /** Bold, in italics, struck or in a link, whose delimiters its source holds: `*`, `~`, brackets… */
  guarded?: boolean
}

/** A source one table's cell reads back the same: `\|` (the double bars) is `\Vert` there, line breaks spaces. */
function latexWritten(formula: InlineFormula) {
  let latex = formula.latex
  if (formula.oneLine || formula.inTable) latex = latex.replace(/\s*\n\s*/g, ' ')
  if (formula.inTable) latex = latex.replace(/\\[\s\S]/g, (escape) => (escape === '\\|' ? '\\Vert ' : escape))
  return latex
}

/**
 * The ways a formula in a line can be written, the best first: as it was written, `$$…$$` if it was,
 * `$…$`, and $`…`$, which Markdown reads nothing in. Among marks whose delimiters its source holds,
 * $`…`$ first: `*a $b*c$*` would end the italics inside it.
 */
function inlineForms(formula: InlineFormula) {
  const latex = latexWritten(formula)
  const forms: string[] = []
  if (formula.guarded) forms.push(`$\`${latex}\`$`)
  else if (formula.raw && latex === formula.latex) forms.push(formula.raw)
  if (formula.raw?.startsWith('$$')) forms.push(`$$${latex}$$`)
  forms.push(`$${latex}$`, `$\`${latex}\`$`)
  return { latex, forms: [...new Set(forms)] }
}

/**
 * Whether `markdown` reads back as the formula `latex` before `following`; at the start of a line,
 * `startsBlock` says whether a formula of its own would start there instead.
 */
function readsAs(markdown: string, latex: string, following = '', startsBlock?: (src: string) => boolean) {
  const read = readInlineMath(markdown + following)
  if (read?.raw !== markdown || read.latex !== latex) return false
  // Alone on its line, `$$…$$` would be one of its own.
  return !startsBlock?.(markdown + following)
}

/**
 * Where a formula of its own can start in a paragraph: at any line (`all`); but on the first, read as
 * text (`later`: a numbered item's text); only on one line of its own (`lines`: a task's text,
 * read line by line); or nowhere (`none`: a table's cell).
 */
export type BlockStarts = 'all' | 'later' | 'lines' | 'none'

/** A formula in a line as Markdown on its own: as it was written, or the first form that reads back. */
export function inlineMathMarkdown(latex: string, raw: string | null) {
  if (!latex.trim()) return ''
  const { latex: written, forms } = inlineForms({ latex, raw })
  return forms.find((form) => readsAs(form, written)) ?? forms.at(-1)!
}

/** A fence longer than any run of its character that starts a line of the formula. */
function fenceFor(latex: string, char: string) {
  const runs = [...latex.matchAll(char === '`' ? /^ {0,3}(`{3,})/gm : /^ {0,3}(~{3,})/gm)].map((m) => m[1]!.length + 1)
  return char.repeat(Math.max(3, ...runs))
}

/** Where a formula of its own is written, which decides how it can be. */
export type BlockPlace = 'block' | 'list' | 'task' | 'table'

/** A line of the formula that would be read as a list's item, a heading or a quote in a list. */
const LIST_LIKE = /^[ \t]*(?:[-+*]|\d{1,9}[.)]|#{1,6}|>)(?:[ \t]|$)/m

/**
 * A formula of its own as Markdown: as it was written, or in its form (fence, one line, `$$` lines)
 * with the new source. In a task's item, whose lines after the first marked reads as text, a fence;
 * in a list's item, a fence if a line of it would start an item there. In a table's cell, which
 * holds one line, a formula in that line.
 */
export function blockMathMarkdown(latex: string, raw: string | null, place: BlockPlace = 'block') {
  if (!latex.trim()) return ''
  if (place === 'table') {
    const { latex: written, forms } = inlineForms({ latex, raw: null, inTable: true })
    return forms.find((form) => readsAs(form, written)) ?? forms.at(-1)!
  }
  const reads = (markdown: string) => {
    const read = readBlockMath(markdown)
    return read?.raw === markdown && read.latex === latex
  }
  const fence = raw ? FENCE_OPEN.exec(raw.split('\n')[0]!) : null
  const fenced = (char: string) => {
    const mark = fenceFor(latex, char)
    return `${mark}math\n${latex}\n${mark}`
  }
  const fenceOnly = place === 'task' || (place === 'list' && LIST_LIKE.test(latex))
  if (raw && reads(raw) && (!fenceOnly || fence)) return raw
  const candidates = [
    ...(fence ? [fenced(fence[2]![0]!)] : []),
    ...(fenceOnly ? [] : [...(raw && !raw.includes('\n') && !latex.includes('\n') ? [`$$${latex}$$`] : []), `$$\n${latex}\n$$`]),
    fenced('`'),
  ]
  return candidates.find(reads) ?? candidates.at(-1)!
}

// What a `$` of text reads as depends on what comes after it, which text alone doesn't know; so
// does how a formula in a line is written. Both are marked where they are written, and settled
// once their paragraph or heading is.

/** Before a `$` of text. */
const DOLLAR = '﷐'
/** Around the number of a formula in a line. */
const OPEN = '﷑'
const CLOSE = '﷒'
const MARKS = /[﷐-﷒]/g

/** Text as Markdown writes it, with each of its `$` marked for settleDollars. */
export const markDollars = (markdown: string) => (markdown.includes('$') ? markdown.replace(/\$/g, () => `${DOLLAR}$`) : markdown)

/** The formula number `index` of the ones settleDollars is given, marked where it goes. */
export const markFormula = (index: number) => `${OPEN}${index}${CLOSE}`

/**
 * The marked `$` and formulas of a paragraph's or a heading's Markdown, written so they read back as
 * they are. A `$` of text that would open a formula is escaped, and so is one that would open a
 * formula of its own at the start of a line; any other stays as it was. A formula is written in the
 * first of its forms that reads back where it is: not one followed by a digit, alone on its line,
 * or next to a `$`. From the end: how each one reads depends only on what follows it.
 */
export function settleDollars(markdown: string, formulas: InlineFormula[] = [], { blocks = 'all' }: { blocks?: BlockStarts } = {}) {
  if (!markdown.match(MARKS)) return markdown
  const parts: string[] = []
  const after = () => parts.slice().reverse().join('')
  const lineStart = (before: string) => {
    if (blocks === 'none') return false
    return (blocks === 'all' ? /(?:^|\n)[ \t]*$/ : /\n[ \t]*$/).test(before.replace(MARKS, ''))
  }
  /** Whether a formula of its own starts at `src`, at the start of a line where one can. */
  const startsBlock = (src: string) => readBlockMath(blocks === 'lines' ? src.split('\n', 1)[0]! : src) !== null
  let end = markdown.length
  for (let i = markdown.length - 1; i >= 0; i--) {
    const char = markdown[i]
    const open = char === CLOSE ? markdown.lastIndexOf(OPEN, i) : -1
    const formula = open === -1 ? undefined : formulas[Number(markdown.slice(open + 1, i))]
    if (formula && /^\d+$/.test(markdown.slice(open + 1, i))) {
      parts.push(markdown.slice(i + 1, end))
      const following = after()
      const { latex, forms } = inlineForms(formula)
      const start = lineStart(markdown.slice(0, open))
      parts.push(forms.find((form) => readsAs(form, latex, following, start ? startsBlock : undefined)) ?? forms.at(-1)!)
      i = open
      end = open
    } else if (char === DOLLAR && markdown[i + 1] === '$') {
      parts.push(markdown.slice(i + 2, end))
      const following = `$${after()}`
      // At the start of any of its lines: a formula of its own breaks a paragraph there.
      const opens = readInlineMath(following) !== null || (lineStart(markdown.slice(0, i)) && startsBlock(following))
      parts.push(opens ? '\\$' : '$')
      end = i
    }
  }
  parts.push(markdown.slice(0, end))
  return parts.reverse().join('')
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
/** One of ours, copied, with its source: an empty one has none to keep. */
const withLatex = (element: HTMLElement) => (element.getAttribute('data-latex')?.trim() ? null : false)

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
  /** The marks it was read in, with `raw`: while they are the same, so is how it reads (markdown.ts). */
  rawMarks: { default: null, rendered: false },
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
      { tag: 'span[data-type="inline-math"]', getAttrs: withLatex },
      // Pasted from a page that draws its formulas with KaTeX, or with MathML (MathJax, Wikipedia).
      { tag: 'span.katex', getAttrs: withTex },
      { tag: 'math:not([display="block"])', getAttrs: withTex },
    ]
  },
  // Copied to another app, its source shows where the formula was.
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'inline-math' }), `$${String(node.attrs.latex ?? '')}$`]
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
  // Written as text is, in its marks' run, and settled with its paragraph (markdown.ts); this is for one written on its own.
  renderMarkdown: (node) => inlineMathMarkdown(String(node.attrs?.latex ?? ''), (node.attrs?.raw as string | null) ?? null),
  addNodeView() {
    return ({ node, editor, getPos }) => new MathView(node, editor, getPos, false)
  },
})

/** Where a formula of its own is, for how it is written (blockMathMarkdown). */
function placeOf(parent: unknown): BlockPlace {
  if (parent === 'taskItem') return 'task'
  if (parent === 'listItem') return 'list'
  // The table writes its cells' blocks itself: they are the table's.
  if (parent === 'table' || parent === 'tableRow' || parent === 'tableCell' || parent === 'tableHeader') return 'table'
  return 'block'
}

/** A formula of its own, between blocks. */
export const FaithfulBlockMath = BlockMath.extend({
  addAttributes() {
    return sourceAttributes()
  },
  parseHTML() {
    return [
      { tag: 'div[data-type="block-math"]', getAttrs: withLatex },
      { tag: '.katex-display', getAttrs: withTex },
      { tag: 'math[display="block"]', getAttrs: withTex },
    ]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'block-math' }), `$$\n${String(node.attrs.latex ?? '')}\n$$`]
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
  // marked adds the line break after it to what it read: no part of the formula.
  parseMarkdown: (token) => ({ type: 'blockMath', attrs: { latex: String(token.latex ?? ''), raw: String(token.raw ?? '').replace(/\n+$/, '') } }),
  renderMarkdown: (node, _helpers, context) => blockMathMarkdown(String(node.attrs?.latex ?? ''), (node.attrs?.raw as string | null) ?? null, placeOf(context?.parentType)),
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
      // Where it was asked for, or the nearest place for text if the page changed under it.
      let $at = tr.doc.resolve(Math.min(pos, tr.doc.content.size))
      if (!$at.parent.inlineContent) $at = Selection.near($at).$from
      const line = $at.parent
      // Never in code, nor in a toggle's title, which hold only text.
      if (line.type.spec.code) return false
      if (!display) {
        // With the marks of the text where it goes: in a link, it stays in the link.
        const type = state.schema.nodes.inlineMath!
        if (!line.canReplaceWith($at.index(), $at.index(), type)) return false
        const node = type.create({ latex }, null, $at.marks().filter((mark) => type.allowsMarkType(mark.type)))
        tr.insert($at.pos, node)
        tr.setSelection(TextSelection.create(tr.doc, $at.pos + node.nodeSize))
        return true
      }
      const node = state.schema.nodes.blockMath!.create({ latex })
      if ($at.depth === 0) return false
      const container = $at.node(-1)
      const select = (at: number) => (tr.setSelection(NodeSelection.create(tr.doc, at)), true)
      if (!line.content.size) {
        // Instead of the empty line; or after it, where the line must stay (an item's first).
        const from = $at.before()
        if (container.canReplaceWith($at.index(-1), $at.indexAfter(-1), node.type)) return (tr.replaceWith(from, $at.after(), node), select(from))
        return (tr.insert($at.after(), node), select($at.after()))
      }
      const before = line.textBetween(0, $at.parentOffset, undefined, '￼')
      const after = line.textBetween($at.parentOffset, line.content.size, undefined, '￼')
      // At the start of the line, before it, unless it must come first (an item's text): then after it.
      if (!before.trim() && container.canReplaceWith($at.index(-1), $at.index(-1), node.type)) return (tr.insert($at.before(), node), select($at.before()))
      if (!before.trim() || !after.trim()) return (tr.insert($at.after(), node), select($at.after()))
      // Splitting the line, without the spaces at the split: they would start or end a line.
      const from = $at.pos - (before.length - before.trimEnd().length)
      const to = $at.pos + (after.length - after.trimStart().length)
      tr.delete(from, to)
      tr.setSelection(TextSelection.create(tr.doc, from))
      tr.replaceSelectionWith(node)
      const placed = tr.mapping.map(from, -1)
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
    // With the marks all the text had: a word in a link stays in it.
    const type = state.schema.nodes.inlineMath!
    const { $from, $to } = state.selection
    const marks = ($from.marksAcross($to) ?? []).filter((mark) => type.allowsMarkType(mark.type))
    tr.replaceWith(source.from, source.to, type.create({ latex }, null, marks))
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
