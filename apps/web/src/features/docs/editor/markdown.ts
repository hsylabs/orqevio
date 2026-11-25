import { type AnyExtension, type JSONContent, type MarkdownRendererHelpers, Node } from '@tiptap/core'
import Blockquote from '@tiptap/extension-blockquote'
import Link from '@tiptap/extension-link'
import { ListItem, ORDERED_LIST_MARKER_PATTERN, OrderedList, TaskItem, TaskList } from '@tiptap/extension-list'
import Paragraph from '@tiptap/extension-paragraph'
import { Table, TableKit } from '@tiptap/extension-table'
import { Markdown, MarkdownManager, assumeContentType } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { t } from 'i18next'
import { DocumentRules } from './block-commands'
import { Callout, calloutFromQuote } from './callout'
import { Toggle, ToggleTitle, foldToggles } from './toggle'
import { FaithfulImage, destination, imageFromTag, indentationOf, isLoneTag, quotedTitle } from './image'
import { FaithfulCodeBlock } from './code-block'
import { INLINE_HTML } from './inline-html'
import { type BlockStarts, FaithfulBlockMath, FaithfulInlineMath, type InlineFormula, markDollars, markFormula, readInlineMath, readingReferences, settleDollars } from './math'

/**
 * Documents are Markdown, often written by agents, and the editor saves the whole
 * document again on every edit. What it can't show must survive that untouched, and
 * what it shows must be written back as it was. This module holds the extensions of
 * the editor's document model (shared with the tests) and the fixes on top of
 * @tiptap/markdown 3.33.0 that make the round trip faithful.
 */

export const SAFE_PROTOCOL = /^(https?:|mailto:|\/(?!\/))/i

// ── Raw HTML ─────────────────────────────────────────────────────
// The editor can't show HTML, so it keeps it as it was: an HTML block becomes a block
// showing its source, an inline tag a chip showing the tag. Both are written back verbatim.


export const RawHtmlBlock = Node.create({
  name: 'htmlBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { html: { default: '' } }
  },
  parseHTML() {
    return [{ tag: 'pre[data-raw-html]', priority: 100, preserveWhitespace: 'full', getAttrs: (el) => ({ html: (el as HTMLElement).textContent ?? '' }) }]
  },
  renderHTML({ node }) {
    return ['pre', { 'data-raw-html': '', class: 'orq-raw-html' }, node.attrs.html as string]
  },
  markdownTokenName: 'html',
  parseMarkdown: (token, helpers) => {
    if (!token.block) return []
    const html = String(token.raw ?? token.text ?? '').replace(/\s+$/, '')
    // An `<img>` tag alone is an image, on a line of its own (image.ts).
    const image = imageFromTag(html)
    if (image) return helpers.createNode('paragraph', undefined, [{ type: 'image', attrs: { ...image } }])
    return html ? helpers.createNode('htmlBlock', { html }) : []
  },
  renderMarkdown: (node) => String(node.attrs?.html ?? ''),
})

export const RawHtmlInline = Node.create({
  name: 'htmlInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { html: { default: '' } }
  },
  parseHTML() {
    return [{ tag: 'code[data-raw-html]', priority: 100, getAttrs: (el) => ({ html: (el as HTMLElement).textContent ?? '' }) }]
  },
  renderHTML({ node }) {
    return ['code', { 'data-raw-html': '', class: 'orq-raw-html-inline' }, node.attrs.html as string]
  },
  markdownTokenName: 'htmlInline',
  // Runs before marked's own tag tokenizer, whose tokens @tiptap/markdown turns into the schema's nodes or drops.
  markdownTokenizer: {
    name: 'htmlInline',
    level: 'inline',
    start: (src: string) => src.search(/<[A-Za-z/!?]/),
    tokenize: (src: string) => {
      const match = INLINE_HTML.exec(src)
      return match ? { type: 'htmlInline', raw: match[0], text: match[0] } : undefined
    },
  },
  parseMarkdown: (token, helpers) => {
    const html = String(token.raw ?? '')
    // An `<img>` tag is an image (image.ts).
    const image = imageFromTag(html)
    return image ? helpers.createNode('image', { ...image }) : helpers.createNode('htmlInline', { html })
  },
  renderMarkdown: (node) => String(node.attrs?.html ?? ''),
})

// ── Raw Markdown ─────────────────────────────────────────────────
// Markdown the editor has no way to show, kept as it was written and shown as its source: front
// matter at the top of a document, footnote definitions and footnote references.

export const RawMarkdownBlock = Node.create({
  name: 'rawMarkdownBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { markdown: { default: '' } }
  },
  parseHTML() {
    return [{ tag: 'pre[data-raw-markdown]', priority: 100, preserveWhitespace: 'full', getAttrs: (el) => ({ markdown: (el as HTMLElement).textContent ?? '' }) }]
  },
  renderHTML({ node }) {
    return ['pre', { 'data-raw-markdown': '', class: 'orq-raw-html' }, node.attrs.markdown as string]
  },
  markdownTokenName: 'footnoteDefinition',
  // A footnote definition, and the lines indented under it. Otherwise marked reads one whose text
  // looks like an address as a link reference definition, which disappears, and escapes the rest.
  markdownTokenizer: {
    name: 'footnoteDefinition',
    level: 'block',
    // Asked at every paragraph with the rest of the document: only the paragraph matters.
    start: (src: string) => {
      const end = src.indexOf('\n\n')
      return (end === -1 ? src : src.slice(0, end)).search(/(?:^|\n) {0,3}\[\^[^\]\s]+\]:/)
    },
    tokenize: (src: string) => {
      const match = /^ {0,3}\[\^[^\]\s]+\]:[^\n]*(?:\n(?: {4}|\t)[^\n]*)*/.exec(src)
      return match ? { type: 'footnoteDefinition', raw: match[0], text: match[0] } : undefined
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode('rawMarkdownBlock', { markdown: String(token.raw ?? '') }),
  renderMarkdown: (node) => String(node.attrs?.markdown ?? ''),
})

export const RawMarkdownInline = Node.create({
  name: 'rawMarkdownInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { markdown: { default: '' } }
  },
  parseHTML() {
    return [{ tag: 'code[data-raw-markdown]', priority: 100, getAttrs: (el) => ({ markdown: (el as HTMLElement).textContent ?? '' }) }]
  },
  renderHTML({ node }) {
    return ['code', { 'data-raw-markdown': '', class: 'orq-raw-html-inline' }, node.attrs.markdown as string]
  },
  markdownTokenName: 'footnoteReference',
  // A footnote reference such as `[^1]`, which marked would read as text with brackets to escape.
  markdownTokenizer: {
    name: 'footnoteReference',
    level: 'inline',
    start: (src: string) => src.indexOf('[^'),
    tokenize: (src: string) => {
      const match = /^\[\^[^\]\s]+\](?![(:[])/.exec(src)
      return match ? { type: 'footnoteReference', raw: match[0], text: match[0] } : undefined
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode('rawMarkdownInline', { markdown: String(token.raw ?? '') }),
  renderMarkdown: (node) => String(node.attrs?.markdown ?? ''),
})

/**
 * YAML front matter: `---` on the first line, its fields, and `---` (or `...`) closing it. Not a
 * rule, a setext heading and text, as marked reads it. A first `---` followed by a blank line is a
 * rule, as it was.
 */
const FRONT_MATTER = /^---[ \t]*\r?\n(?![ \t]*\r?\n)[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?=\r?\n|$)/

// ── Text ─────────────────────────────────────────────────────────

/** Backslash-escapes what would open a block at the start of a line: headings, lists, quotes, rules, setext underlines. */
export function escapeLineStarts(markdown: string) {
  return markdown
    .split('\n')
    .map((line) =>
      line
        .replace(/^(\s{0,3})(#{1,6})(?=\s|$)/, '$1\\$2')
        .replace(/^(\s{0,3})([-+])(?=\s|$)/, '$1\\$2')
        .replace(/^(\s{0,3})(\d{1,9})([.)])(?=\s|$)/, '$1$2\\$3')
        .replace(/^(\s{0,3})>/, '$1\\>')
        .replace(/^(\s{0,3})(-[ \t]*-[ \t]*-[ \t-]*)$/, '$1\\$2')
        .replace(/^(\s{0,3})(=+[ \t]*)$/, '$1\\$2'),
    )
    .join('\n')
}

/**
 * Writes text so it reads back the same, changing as little as possible: only an `&`
 * that would start an entity and a `<` that would start a tag are escaped, and
 * non-breaking spaces stay visible as `&nbsp;`. @tiptap/markdown turns every `&`, `<`
 * and `>` into entities instead.
 */
export function encodeText(escapedMarkdown: string) {
  return escapedMarkdown
    .replace(/&(?=#\d{1,7};|#[xX][0-9a-fA-F]{1,6};|[A-Za-z][A-Za-z0-9]{1,31};)/g, '&amp;')
    .replace(/<(?=[A-Za-z/!?])/g, '\\<')
    .replace(/ /g, '&nbsp;')
}

let entityDecoder: HTMLTextAreaElement | null = null
/**
 * Decodes named entities such as `&nbsp;` or `&eacute;`. @tiptap/markdown decodes only
 * `&lt;`, `&gt;`, `&quot;`, `&amp;` and numeric ones, and it still does: they are left alone
 * here so nothing is decoded twice.
 */
export function decodeNamedEntities(text: string) {
  if (!text.includes('&') || typeof document === 'undefined') return text
  return text.replace(/&([A-Za-z][A-Za-z0-9]{1,31});/g, (entity, name: string) => {
    if (['lt', 'gt', 'quot', 'amp'].includes(name)) return entity
    entityDecoder ??= document.createElement('textarea')
    entityDecoder.innerHTML = entity
    return entityDecoder.value
  })
}

// ── Paragraphs and images ────────────────────────────────────────

const FaithfulParagraph = Paragraph.extend({
  // An image alone in a paragraph stays an inline image inside it: images are inline here.
  parseMarkdown(token, helpers) {
    const parsed = this.parent?.(token, helpers) as JSONContent | JSONContent[] | undefined
    if (parsed && !Array.isArray(parsed) && parsed.type === 'paragraph') return parsed
    return helpers.createNode('paragraph', undefined, helpers.parseInline(token.tokens ?? []))
  },
  renderMarkdown(node, helpers, context) {
    const written = this.parent?.(node, helpers, context) ?? ''
    const parent = String(context?.parentType ?? '')
    // A table writes each line break of a cell as `<br>`: a line break inside a tag would undo it.
    // Only the cell's first line starts it: after a `<br>`, nothing starts a block to escape.
    if (TABLE_PARENTS.has(parent)) {
      const end = written.indexOf('\n')
      return end === -1 ? escapeLineStarts(written) : escapeLineStarts(written.slice(0, end)) + written.slice(end)
    }
    const markdown = escapeLineStarts(written)
    // An `<img>` tag that was alone on its line keeps its indentation, where it can't change the item it is in.
    const [only, ...more] = node.content ?? []
    // (Not on an item's first line, which follows its marker.)
    const lead = only?.type === 'image' && !more.length && !(LIST_PARENTS.has(parent) && !context?.index) ? indentationOf(only.attrs?.html) : ''
    return lead + keepImageInline(markdown)
  },
})

const TABLE_PARENTS = new Set(['table', 'tableRow', 'tableCell', 'tableHeader'])
const LIST_PARENTS = new Set(['listItem', 'taskItem'])

/**
 * A paragraph whose first line is only an `<img>` tag, with more lines after it (an image with a
 * size, then text or another image under it): such a line starts an HTML block, which would take
 * the lines after it as HTML. A line break inside the tag keeps it an image in the paragraph.
 */
function keepImageInline(markdown: string) {
  const end = markdown.indexOf('\n')
  if (end === -1 || !isLoneTag(markdown.slice(0, end))) return markdown
  return markdown.replace(/^(\s*<img)[ \t]+/i, '$1\n')
}

// ── Quotes ───────────────────────────────────────────────────────

/**
 * The marker of an alert at the start of a quote, as text escapes it: GitHub's `[!NOTE]` or an
 * Obsidian callout such as `[!tip]-`. Only before a space or the end of the line, where it is
 * text again when read back; followed by `:` or `(` it would be a link reference definition or a link.
 */
const ESCAPED_ALERT = /^> \\\[!([A-Za-z][A-Za-z0-9-]*)\\\](?=[+-]?(?:[ \t]|\n|$))/

/**
 * An alert keeps its marker as written. Escaped, `> [!NOTE]` stops being an alert, so the marker
 * of a quote's first paragraph is written as it is, unless it was escaped where it came from:
 * someone showing how to write one.
 */
const FaithfulBlockquote = Blockquote.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // In the HTML too, which copying and pasting goes through.
      escapedMarker: {
        default: false,
        parseHTML: (element) => element.hasAttribute('data-escaped-marker'),
        renderHTML: (attributes) => (attributes.escapedMarker ? { 'data-escaped-marker': '' } : {}),
      },
    }
  },
  parseMarkdown(token, helpers) {
    const quote = this.parent?.(token, helpers) as JSONContent
    // A marker read from the first paragraph that was not written as such there was escaped, in
    // whatever way: `\[!NOTE\]`, `[!NOTE\]`, `[\!NOTE]`, `&#91;!NOTE]`…
    const text = quote.content?.[0]?.type === 'paragraph' ? quote.content[0].content?.[0] : undefined
    const marker = text?.type === 'text' ? /^\[![A-Za-z][A-Za-z0-9-]*\]/.exec(text.text ?? '')?.[0] : undefined
    // The quote's first paragraph as written, without the `>` marked has already taken away.
    const tokens = (token.tokens as Array<{ type?: string; raw?: string }> | undefined) ?? []
    const index = tokens.findIndex((child) => child.type !== 'space')
    const first = tokens[index]
    const escaped = !!marker && first?.type === 'paragraph' && !(first.raw ?? '').startsWith(marker)
    const read = escaped ? { ...quote, attrs: { ...quote.attrs, escapedMarker: true } } : quote
    // One of GitHub's alerts is a callout (callout.ts); a blank line after its marker is kept.
    return calloutFromQuote(read, tokens[index + 1]?.type === 'space') ?? read
  },
  renderMarkdown(node, helpers, context) {
    const markdown = this.parent?.(node, helpers, context) ?? ''
    return node.attrs?.escapedMarker ? markdown : markdown.replace(ESCAPED_ALERT, '> [!$1]')
  },
})


/** Whether the parentheses in `href` pair up, as a link's address may hold them without `<>`. */
function balancedParentheses(href: string) {
  let depth = 0
  for (const char of href) {
    if (char === '(') depth++
    else if (char === ')' && --depth < 0) return false
  }
  return depth === 0
}

// A link's address with spaces or angle brackets goes between `<>`, or it stops being a link.
const FaithfulLink = Link.extend({
  renderMarkdown: (node, helpers) => {
    const href = String(node.attrs?.href ?? '')
    const title = String(node.attrs?.title ?? '')
    const address = /[\s<>]/.test(href) || !balancedParentheses(href) ? destination(href) : href
    return `[${helpers.renderChildren(node)}](${address}${title ? ` ${quotedTitle(title)}` : ''})`
  },
})

// ── Ordered lists ────────────────────────────────────────────────

const ORDERED_ITEM = new RegExp(`^([ \\t]*)(${ORDERED_LIST_MARKER_PATTERN})([.)])( +)`)
/**
 * An empty item of a numbered list: its number alone (`2.`), at most three spaces in (four make
 * it code). @tiptap/extension-list wants a space after the number: without it, the line ended the
 * list or went into the text of the item above (alignOrderedContinuations).
 */
const EMPTY_ORDERED_ITEM = /^( {0,3})(\d{1,9}[.)])[ \t]*$/
const FENCE = /^(`{3,}|~{3,})/
/** The start of a block that runs on over the next lines: code, a formula, HTML. */
const OPENS_A_BLOCK = /^(?:`{3}|~{3}|\$\$|<)/
/**
 * Put before a line of code that looks like an item of an ordered list (`1. + 2` in a code block
 * under a numbered step), for the time @tiptap/extension-list reads the list: it would take the
 * line for an item and split the code there. Taken out of what it read straight after.
 */
const NOT_AN_ITEM = '\uE000'

/**
 * Lines under an item of an ordered list belong to it from the column its text starts at (3 for
 * `1. `). @tiptap/extension-list 3.33.0 strips one column fewer (the marker and one space, without
 * the `.`), and then trims only the first line: in `1. paso` with `   - [ ] a` and `   - [x] b`
 * under it, the second task ends up inside the first. The extra column is taken off here first.
 *
 * An item of a list indented otherwise than its first, by up to three spaces and less than the
 * text of the item above, is one more of its items, as CommonMark and marked read it; so in a list
 * inside an item, from where the item's text starts. Its number is put in line with the others,
 * and what is under it moves with it: @tiptap/extension-list made it an item of a list inside the
 * one above (` 2.` under `1. uno`), or lost it if it was less indented than the first (`2.` under
 * ` 1.`). Only numbers: CommonMark has no letters or roman numerals, which stay as they were.
 *
 * An empty item, its number alone (`2.`) at the list's own margin, is an item too: it gets the
 * space after its number that @tiptap/extension-list wants. A space or two off, so is it where
 * nothing can be open under the item above (right under its line, or under an empty one). Only
 * there: a number alone further in is a line of what the item above holds (code, a formula), as
 * it was. What comes right under an empty item is its own only if it is indented as its text was,
 * with no blank line before it; another item of the list goes on with it, and anything else ends
 * the list there, where marked ends it, rather than going into the item.
 */
export function alignOrderedContinuations(src: string) {
  let item: { strippedThere: number; textColumn: number } | null = null
  /**
   * The lists open, from the list's own in: how far in the first item of each is, the column the
   * text of its item read last starts at (what is less indented is no longer in it), and how far
   * that item was moved to be in line with the others (what is under it moves as far).
   */
  const levels: Array<{ margin: number; text: number; moved: number }> = []
  /** The list the item read last is one of, in `levels`: -1 if none. */
  let level = -1
  /** The fence of a code block open under the item: its lines are code, whatever they look like. */
  let fence: { char: string; length: number } | null = null
  /** How far in the list's own items are, from its first. */
  let margin = -1
  /** Whether the item read last is empty, and nothing is its own yet. */
  let emptyItem = false
  /** Whether nothing is open under the item read last: no text under its line, and no block on it. */
  let clear = false
  const protect = !src.includes(NOT_AN_ITEM)
  let aligned = ''
  let previousBlank = false
  // Line by line, up to where the list ends: the rest of the document is left as it is.
  for (let start = 0; start <= src.length; ) {
    const newline = src.indexOf('\n', start)
    const end = newline === -1 ? src.length : newline
    let line = src.slice(start, end)
    /**
     * Whether the line is under the item read last of each list open, as it was written: from where
     * its text started. A line under an item moved in line with the others moves as far, from the
     * outermost list in; so does one the item's new text would take in, which goes on with its text.
     */
    const under = levels.map(() => false)
    if (line.trim()) {
      const spaces = /^ *$/.test(line.slice(0, line.length - line.trimStart().length))
      levels.forEach((open, depth) => {
        const lead = line.length - line.trimStart().length
        under[depth] = lead >= open.text - open.moved
        if (spaces && open.moved && lead >= Math.min(open.text, open.text - open.moved)) {
          line = open.moved > 0 ? `${' '.repeat(open.moved)}${line}` : line.slice(-open.moved)
        }
      })
    }
    const lead = line.length - line.trimStart().length
    // A line less indented than the item's text closes a code block left open under it.
    if (fence && line.trim() && item && lead < item.textColumn) fence = null
    const empty = fence ? null : EMPTY_ORDERED_ITEM.exec(line)
    const atMargin = (indent: string) => margin === -1 || indent.length === margin
    const bare = !!empty && (atMargin(empty[1]!) || (clear && levels.length > 0 && empty[1]!.length < levels[0]!.text))
    /** How far the item on this line is moved to be in line with the others. */
    let moved = 0
    if (bare) {
      if (margin !== -1) moved = margin - empty![1]!.length
      line = `${' '.repeat(empty![1]!.length + moved)}${empty![2]} `
    }
    let match = fence ? null : ORDERED_ITEM.exec(line)
    level = -1
    if (match && /^ *$/.test(match[1]!) && /^\d+$/.test(match[2]!)) {
      const at = match[1]!.length
      // After an empty item and a blank line nothing more is its own: an item there is one more of the list.
      const closed = emptyItem && previousBlank
      // From the innermost list out: in the text of its item read last, it starts a list there;
      // otherwise, up to three spaces in from where that list may start, it is one more of its items.
      for (let depth = levels.length - 1; depth >= 0; depth--) {
        const { margin: first, text } = levels[depth]!
        const from = depth ? levels[depth - 1]!.text : 0
        if (under[depth] && !(closed && depth === 0)) {
          if (at - text <= 3) level = levels.push({ margin: at, text: -1, moved: 0 }) - 1
          break
        }
        if (at >= from && at - from <= 3) {
          levels.length = depth + 1
          level = depth
          // One more item of the list, indented otherwise than its first: in line with the others.
          if (at !== first) {
            moved = first - at
            line = `${' '.repeat(first)}${line.slice(at)}`
            match = ORDERED_ITEM.exec(line)
          }
          break
        }
      }
      if (!levels.length) level = levels.push({ margin: at, text: -1, moved: 0 }) - 1
    }
    if (emptyItem && line.trim() && !(match && atMargin(match[1]!))) {
      // Under an empty item, only what was indented as its text, with no blank line before it, is its own.
      if (previousBlank || !(levels.length ? under[0] : lead >= item!.textColumn)) return aligned.replace(/\n$/, '')
      emptyItem = false
    }
    if (match) {
      if (margin === -1) margin = match[1]!.length
      emptyItem = bare
      clear = !OPENS_A_BLOCK.test(line.slice(match[0].length))
      const [, indent = '', marker = '', , spaces = ''] = match
      // Five spaces or more after the marker: the text starts after one, and the rest is code.
      const gap = spaces.length > 4 ? 1 : spaces.length
      item = { strippedThere: indent.length + marker.length + 1, textColumn: indent.length + marker.length + 1 + gap }
      if (level !== -1) Object.assign(levels[level]!, { text: item.textColumn, moved })
    } else if (item && line.trim()) {
      clear = false
      // Less indented than the text of the item read last in a list inside another: that list is over.
      while (levels.length > 1 && !under[levels.length - 1]) levels.pop()
      // Text at the margin after a blank line: the list is over.
      if (lead === 0 && previousBlank && !fence) return aligned + src.slice(start)
      const text = line.trimStart()
      const run = FENCE.exec(text)?.[1]
      if (fence) {
        if (run && run[0] === fence.char && run.length >= fence.length && !text.slice(run.length).trim()) fence = null
        else if (protect && ORDERED_ITEM.test(line)) line = `${line.slice(0, lead)}${NOT_AN_ITEM}${text}`
      } else if (run && lead >= item.textColumn) fence = { char: run[0]!, length: run.length }
      if (lead >= item.textColumn) line = line.slice(item.textColumn - item.strippedThere)
    }
    previousBlank = !line.trim()
    aligned += newline === -1 ? line : `${line}\n`
    if (newline === -1) break
    start = newline + 1
  }
  return aligned
}

/** Takes NOT_AN_ITEM out of the strings of `value`, however deep, in place. */
function removeMarks(value: unknown, seen = new WeakSet<object>()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  const entries = value as Record<string, unknown>
  for (const key of Object.keys(entries)) {
    const field = entries[key]
    if (typeof field === 'string') {
      if (field.includes(NOT_AN_ITEM)) entries[key] = field.replaceAll(NOT_AN_ITEM, '')
    } else removeMarks(field, seen)
  }
}

/** The first `count` lines of `text`. */
function firstLines(text: string, count: number) {
  let end = -1
  for (let i = 0; i < count; i++) {
    end = text.indexOf('\n', end + 1)
    if (end === -1) return text
  }
  return text.slice(0, end)
}

type ListTokenizer = { name: string; level: 'block'; start: (src: string) => number; tokenize: (src: string, tokens: unknown[], lexer: unknown) => { raw: string } | undefined }
const orderedListTokenizer = (OrderedList.config as { markdownTokenizer: ListTokenizer }).markdownTokenizer

const FaithfulOrderedList = OrderedList.extend({
  markdownTokenizer: {
    ...orderedListTokenizer,
    tokenize: (src: string, tokens: unknown[], lexer: unknown) => {
      // Tried at the start of every block: only an ordered list is worth the work.
      const end = src.indexOf('\n')
      // One line alone is also how @tiptap/extension-list asks whether a line goes on with the text
      // of a task or an item above it: read as it always was (`2.` alone is no list, and goes on).
      if (end === -1 || end === src.length - 1) return orderedListTokenizer.tokenize(src, tokens, lexer)
      const first = src.slice(0, end)
      if (!ORDERED_ITEM.test(first) && !EMPTY_ORDERED_ITEM.test(first)) return orderedListTokenizer.tokenize(src, tokens, lexer)
      const aligned = alignOrderedContinuations(src)
      const token = orderedListTokenizer.tokenize(aligned, tokens, lexer)
      if (!token) return token
      // Only marks put there now: a document that held the character already got none, and keeps it.
      if (!src.includes(NOT_AN_ITEM) && aligned.includes(NOT_AN_ITEM)) removeMarks(token)
      // What it took from the source, as it was: marked goes on from there.
      return { ...token, raw: firstLines(src, token.raw.split('\n').length) }
    },
  },
})


// ── List items ───────────────────────────────────────────────────

/** An item written without the whitespace-only line a block can leave at its end (a toggle's, a table's). */
const withoutTrailingLine = (markdown: string) => markdown.replace(/\n[ \t]*$/, '')

/** An empty line of text, which every item starts with in the editor. */
const emptyLine = (): JSONContent => ({ type: 'paragraph' })

/**
 * The document read, with each item of a list starting with a line of text, as the editor's items
 * do: @tiptap/extension-list reads an empty numbered item (`2.`) with nothing in it, and one with
 * only a block under its number (`2.` and `   - a`) with no such line, which the editor can't
 * write in; the first was written as nothing.
 */
function fillEmptyItems(nodes: JSONContent[]): JSONContent[] {
  return nodes.map((node) => {
    const content = node.content ? fillEmptyItems(node.content) : node.content
    if (node.type === 'listItem' && content?.[0]?.type !== 'paragraph') return { ...node, content: [emptyLine(), ...(content ?? [])] }
    return content ? { ...node, content } : node
  })
}

/**
 * The helpers an item of a list is written with, but for each rule right under a paragraph with
 * text: the item writes its blocks one line under the other, and `---` under a line of text makes
 * it a heading (`***` is written `---` too), which lost the rule on the next save. Such a rule is
 * marked, and written after a blank line. A task reads that line as a rule here, but marked and
 * GitHub read a heading there too: it is written so as well.
 */
function rulesApart(node: JSONContent, helpers: MarkdownRendererHelpers) {
  const content = node.content ?? []
  const apart = new Set(content.flatMap((child, index) => (child.type === 'horizontalRule' && content[index - 1]?.type === 'paragraph' && content[index - 1]!.content?.length ? [index] : [])))
  if (!apart.size) return { helpers, write: (markdown: string) => markdown }
  // A mark of its own for each item written: text that holds the same characters is no rule.
  const mark = `\uE001${Math.random().toString(36).slice(2, 10)}\uE001`
  const renderChild = (child: JSONContent, index: number) => {
    const markdown = helpers.renderChild ? helpers.renderChild(child, index) : helpers.renderChildren([child])
    return apart.has(index) ? `${mark}${markdown}` : markdown
  }
  return { helpers: { ...helpers, renderChild }, write: (markdown: string) => markdown.replace(new RegExp(`\\n([ \\t]*)${mark}`, 'g'), '\n\n$1') }
}

/**
 * A list item read as blocks. In a tight list marked gives the lines after a heading, a toggle or
 * other HTML as bare text, and @tiptap/extension-list makes only the first one a paragraph: the
 * others went straight in the item, an invalid document whose text was escaped again on every
 * save. Then, and only then, each is a paragraph, as in a loose list (an item of only `&nbsp;`
 * read as a paragraph would be empty). Written without a trailing whitespace-only line, which
 * would make the list loose, or split a task list in two; but with the one an empty last
 * paragraph is written as, which is that paragraph.
 */
const FaithfulListItem = ListItem.extend({
  parseMarkdown(token, helpers) {
    if (!token.tokens?.some((child, index) => index > 0 && child.type === 'text')) return this.parent?.(token, helpers) ?? []
    const tokens = token.tokens.map((child) => (child.type === 'text' ? { ...child, type: 'paragraph' } : child))
    return this.parent?.({ ...token, tokens }, helpers) ?? []
  },
  renderMarkdown(node, helpers, context) {
    // An item without a first line of text (in content given as JSON) is written as one with an
    // empty one, which is how the editor keeps it.
    if (node.content?.[0]?.type !== 'paragraph') node = { ...node, content: [emptyLine(), ...(node.content ?? [])] }
    const apart = rulesApart(node, helpers)
    let markdown = apart.write(this.parent?.(node, apart.helpers, context) ?? '')
    // An empty item is its marker alone, as it is written by hand (`2.`, `-`): marked reads no item
    // in `- ` with nothing after it, and an empty first item of a list so was lost on the next save.
    const list = context?.parentType === 'orderedList' || context?.parentType === 'bulletList'
    if (list && node.content!.length === 1 && !node.content![0]!.content?.length) markdown = markdown.replace(/^(\d{1,9}[.)]|[-+*]) +$/, '$1')
    // An item that starts with a block: the empty line the editor keeps before it is no line, and a
    // marker alone on its line would lose the item. In a bulleted list a formula of its own or a
    // block of code goes on the marker's line, as it was written (`- $$x$$`, `- ```js`); anywhere
    // else (a numbered list reads that line as text) the line keeps `&nbsp;`, as nested items have it.
    const [first, second] = node.content ?? []
    if (first?.type === 'paragraph' && !first.content?.length && second) {
      if (context?.parentType === 'bulletList' && (second.type === 'blockMath' || second.type === 'codeBlock')) {
        markdown = markdown.replace(/^([-+*] +)(?:&nbsp;)?\n[ \t]*/, '$1')
      } else {
        // A rule right under a line of text would make it a heading: a blank line between them.
        markdown = markdown.replace(/^((?:[-+*]|\d{1,9}[.)]) +)(?:&nbsp;)?\n/, second.type === 'horizontalRule' ? '$1&nbsp;\n\n' : '$1&nbsp;\n')
      }
    }
    const last = node.content?.at(-1)
    return last?.type === 'paragraph' && !last.content?.length ? markdown : withoutTrailingLine(markdown)
  },
})

/**
 * A task read with the blocks under its first line, which marked gives as bare text when they
 * follow a list there (`- [ ] t` with `  2.` and `  texto` under it): each is a paragraph, or
 * the document is invalid. Written as a list item is, with each rule right under its text apart.
 */
const FaithfulTaskItem = TaskItem.extend({
  parseMarkdown(token, helpers) {
    const nested = token.nestedTokens as typeof token.tokens
    if (!nested?.some((child) => child.type === 'text')) return this.parent?.(token, helpers) ?? []
    const nestedTokens = nested.map((child) => (child.type === 'text' ? { ...child, type: 'paragraph' } : child))
    return this.parent?.({ ...token, nestedTokens }, helpers) ?? []
  },
  renderMarkdown(node, helpers, context) {
    const apart = rulesApart(node, helpers)
    return withoutTrailingLine(apart.write(this.parent?.(node, apart.helpers, context) ?? ''))
  },
})

// ── Tables ───────────────────────────────────────────────────────

/**
 * A table of the document's top level, of a quote, a callout or a toggle is written without the blank lines
 * @tiptap/extension-table puts around it: blocks are already apart there. With them, two tables in a
 * row read back with an empty paragraph between them, one more on every save. In a list item they
 * hold its lines apart, and stay.
 */
const FaithfulTable = Table.extend({
  renderMarkdown(node, helpers, context) {
    const markdown = this.parent?.(node, helpers, context) ?? ''
    return ['doc', 'blockquote', 'callout', 'toggle'].includes(String(context.parentType)) ? markdown.replace(/^\n+|\n+$/g, '') : markdown
  },
})

// ── Markdown manager ─────────────────────────────────────────────

type Token = { type?: string; text?: string; raw?: string; tokens?: Token[] }
/** The private methods of MarkdownManager 3.33.0 patched below; the round-trip tests catch any change. */
interface ManagerInternals {
  codeTypes: Set<string>
  escapeMarkdownSyntax(text: string): string
  encodeTextForMarkdown(text: string, node: JSONContent, parentNode?: JSONContent): string
  renderNodeToMarkdown(node: JSONContent, ...rest: unknown[]): string
  parseInlineTokens(tokens: Token[]): JSONContent[]
  applyMarkToContent(markType: string, content: JSONContent[], attrs?: Record<string, unknown>): JSONContent[]
}

type MarkedList = (this: unknown, src: string) => { raw: string } | undefined | false
interface MarkedInstance {
  Tokenizer: { prototype: { list: MarkedList } }
  use(extension: { tokenizer: { list: MarkedList } }): unknown
}
const readingListsAgain = new WeakSet<object>()
/**
 * marked's own reading of a list, which a quote reads again with the lines that follow it without
 * `>`, takes no list whose first item is four spaces in or more, or is a marker with only spaces
 * after it (`> 2. ` or `>     1. a`, then `texto`): @tiptap/extension-list had read a list there,
 * and the page couldn't be opened. Then it is read with its lines as far left as the first can go,
 * and the marker alone: the same items.
 */
function readListsAgain(instance: MarkedInstance) {
  if (readingListsAgain.has(instance)) return
  readingListsAgain.add(instance)
  const list = instance.Tokenizer.prototype.list
  instance.use({
    tokenizer: {
      list(src) {
        const token = list.call(this, src)
        if (token) return token
        const first = /^( *)([*+-]|\d{1,9}[.)])([ \t]+(?=\n|$)|(?=[ \t]|\n|$))/.exec(src)
        if (!first) return false
        const lead = first[1]!.length
        const lines = src.split('\n')
        lines[0] = `${first[2]}${lines[0]!.slice(first[0].length)}`
        for (let i = 1; i < lines.length; i++) lines[i] = lines[i]!.slice(Math.min(lead, /^ */.exec(lines[i]!)![0].length))
        const read = list.call(this, lines.join('\n'))
        if (!read) return false
        // What it took from the source, as it was: the quote goes on from there.
        const taken = read.raw.split('\n')
        const ends = taken.at(-1) === ''
        return { ...read, raw: firstLines(src, ends ? taken.length - 1 : taken.length) + (ends ? '\n' : '') }
      },
    },
  })
}

function faithfulManager(options: ConstructorParameters<typeof MarkdownManager>[0]) {
  const manager = new MarkdownManager(options)
  readListsAgain(manager.instance as unknown as MarkedInstance)
  const internals = manager as unknown as ManagerInternals

  // A formula in a line is written as text with its marks, in their run: `**a $x$ b**` and
  // `[a $x$](…)` stay as they are. @tiptap/markdown closes the marks around any other inline node.
  // Its form is chosen once its paragraph or heading is written, where it is (math.ts).
  let formulas: InlineFormula[] = []
  let placeholder = /$^/
  /** Where formulas of their own can start in a paragraph that isn't read as others are (math.ts). */
  let blockStarts = new WeakMap<JSONContent, BlockStarts>()
  const asText = (node: JSONContent, where: { heading?: boolean; table?: boolean; ordered?: boolean }, key: string): JSONContent => {
    if (node.type === 'inlineMath') {
      const marks = (node.marks ?? []).map((mark) => mark.type)
      const latex = String(node.attrs?.latex ?? '')
      if (!latex.trim()) return { type: 'text', text: '' }
      const raw = (node.attrs?.raw as string | null) ?? null
      // Read with these marks and this source, it reads back the same; otherwise the delimiters of
      // its marks in its source would end them there: `*` of italics or bold, `~` of strikes,
      // brackets and backticks of a link.
      const asRead = raw !== null && readInlineMath(raw)?.latex === latex && sameMarks(node.attrs?.rawMarks, marks)
      const guarded =
        !asRead &&
        ((marks.some((mark) => mark === 'bold' || mark === 'italic') && latex.includes('*')) ||
          (marks.includes('strike') && latex.includes('~')) ||
          (marks.includes('link') && /[[\]`<>]/.test(latex)))
      formulas.push({ latex, raw, oneLine: where.heading || where.table, inTable: where.table, guarded })
      return { type: 'text', text: `\uFDD3${key}:${formulas.length - 1}\uFDD4`, ...(node.marks ? { marks: node.marks } : {}) }
    }
    if (!node.content) return node
    if ((node.type === 'tableCell' || node.type === 'tableHeader') && node.content.length > 1) {
      // A cell holding other blocks (a list, code) stays as it is.
      const line = oneLine(node)
      if (line !== node) return asText(line, where, key)
    }
    // `ordered`: the node is an item of a numbered list.
    const inner = { heading: where.heading || node.type === 'heading', table: where.table || node.type === 'tableCell' || node.type === 'tableHeader', ordered: node.type === 'orderedList' }
    const written = { ...node, content: node.content.map((child) => asText(child, inner, key)) }
    // A task's text is read line by line, the first as text (@tiptap/extension-list); a numbered
    // item's first line is read as text too.
    const first = written.content[0]
    if (first?.type === 'paragraph' && node.type === 'taskItem') blockStarts.set(first, 'lines')
    else if (first?.type === 'paragraph' && node.type === 'listItem' && where.ordered) blockStarts.set(first, 'later')
    return written
  }

  internals.encodeTextForMarkdown = (text, node, parentNode) => {
    const formula = placeholder.exec(text)
    if (formula) return markFormula(Number(formula[1]))
    const inCode =
      (parentNode?.type != null && internals.codeTypes.has(parentNode.type)) ||
      (node.marks ?? []).some((m) => internals.codeTypes.has(typeof m === 'string' ? m : m.type))
    // Each `$` is settled once its paragraph or heading is written: escaped where it would open a formula (math.ts).
    return inCode ? text : markDollars(encodeText(internals.escapeMarkdownSyntax(text)))
  }
  const renderNodeToMarkdown = internals.renderNodeToMarkdown.bind(manager)
  internals.renderNodeToMarkdown = (node, ...rest) => {
    const markdown = renderNodeToMarkdown(node, ...rest)
    if (node.type !== 'paragraph' && node.type !== 'heading') return markdown
    // In a table, as the table writes its cell, its line breaks as `<br>`; no block starts there.
    const [parent] = rest as [JSONContent | undefined]
    if (TABLE_PARENTS.has(String(parent?.type ?? ''))) return settleDollars(markdown.replace(/[ \t]*\r?\n[ \t]*/g, '<br>'), formulas, { blocks: 'none' })
    return settleDollars(markdown, formulas, { blocks: blockStarts.get(node) ?? 'all' })
  }
  // Text anywhere else is settled with the whole document after it: a `$` that might open a formula there is escaped.
  const serialize = manager.serialize.bind(manager)
  manager.serialize = (doc: JSONContent) => {
    // A key of its own for each writing: a text that looks like a formula's place is no formula.
    const key = Math.random().toString(36).slice(2, 10)
    formulas = []
    blockStarts = new WeakMap()
    placeholder = new RegExp(`^\\uFDD3${key}:(\\d+)\\uFDD4$`)
    try {
      return settleDollars(serialize(asText(doc, {}, key)), formulas)
    } finally {
      formulas = []
      placeholder = /$^/
    }
  }

  // Front matter stays at the top as written; the rest is read as usual, with its `<details>` as toggles (toggle.ts).
  const read = manager.parse.bind(manager)
  const parse = (markdown: string) => {
    // Knowing the references the page defines: a formula never ends in the text of a link to one (math.ts).
    const doc = readingReferences(markdown, () => read(markdown))
    return { ...doc, content: foldToggles(fillEmptyItems(doc.content ?? [])) }
  }
  manager.parse = (markdown: string) => {
    const front = FRONT_MATTER.exec(markdown)
    if (!front) return parse(markdown)
    const rest = parse(markdown.slice(front[0].length).replace(/^(?:[ \t]*\r?\n)+/, ''))
    return { ...rest, type: 'doc', content: [{ type: 'rawMarkdownBlock', attrs: { markdown: front[0] } }, ...(rest.content ?? [])] }
  }

  const parseInlineTokens = internals.parseInlineTokens.bind(manager)
  internals.parseInlineTokens = (tokens) =>
    parseInlineTokens(tokens.map((t) => (t.type === 'text' && t.text ? { ...t, text: decodeNamedEntities(t.text) } : t)))

  // Links around an image (a badge) stay on the image, and any mark around a formula on the
  // formula (`**$x$**`); marks only reach text otherwise.
  const applyMarkToContent = internals.applyMarkToContent.bind(manager)
  internals.applyMarkToContent = (markType, content, attrs) =>
    applyMarkToContent(markType, content, attrs).map((node, i) => {
      const mark = { type: markType, ...(attrs ? { attrs } : {}) }
      if (markType === 'link' && content[i]?.type === 'image') return { ...node, marks: [...(node.marks ?? []), mark] }
      if (content[i]?.type !== 'inlineMath') return node
      // The marks it was read in, with its source: written so again while they are the same (math.ts).
      const read = [...((node.attrs?.rawMarks as string[] | null) ?? []), markType]
      return { ...node, attrs: { ...node.attrs, rawMarks: read }, marks: [...(node.marks ?? []), mark] }
    })

  return manager
}

/**
 * A table's cell of several lines (paragraphs, formulas of their own) as one paragraph with line
 * breaks: the table writes them so anyway, `a<br>b`, and so its `$` and formulas are settled as the
 * rest are, before the table escapes its pipes and measures its columns.
 */
function oneLine(cell: JSONContent): JSONContent {
  const blocks = cell.content ?? []
  if (!blocks.every((block) => block.type === 'paragraph' || block.type === 'blockMath')) return cell
  const content: JSONContent[] = []
  blocks.forEach((block, index) => {
    if (index) content.push({ type: 'hardBreak' })
    if (block.type === 'blockMath') content.push({ type: 'inlineMath', attrs: { latex: block.attrs?.latex ?? '', raw: null } })
    else content.push(...(block.content ?? []))
  })
  return { ...cell, content: [{ type: 'paragraph', content }] }
}

/** Whether the marks a formula was read in are the ones it has now. */
function sameMarks(read: unknown, now: string[]) {
  const before = Array.isArray(read) ? [...(read as string[])].sort() : []
  return before.join() === [...now].sort().join()
}

/** @tiptap/markdown with the faithful manager; the same as its own setup otherwise. */
const FaithfulMarkdown = Markdown.extend({
  onBeforeCreate() {
    const manager = faithfulManager({
      indentation: this.options.indentation,
      marked: this.options.marked,
      markedOptions: this.options.markedOptions,
      extensions: this.editor.extensionManager.baseExtensions,
    })
    this.storage.manager = manager
    this.editor.markdown = manager
    this.editor.getMarkdown = () => manager.serialize(this.editor.getJSON())
    const { content, contentType } = this.editor.options
    if (!contentType || assumeContentType(content, contentType) !== 'markdown' || typeof content !== 'string') return
    const json = manager.parse(content)
    if (json.content?.length) this.editor.options.content = json
  },
})

/** The extensions that make up a document: what it can hold and how it reads and writes Markdown. */
export function documentExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      paragraph: false,
      underline: false,
      link: false,
      codeBlock: false,
      orderedList: false,
      blockquote: false,
      listItem: false,
    }),
    FaithfulListItem,
    FaithfulLink.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      defaultProtocol: 'https',
      isAllowedUri: (url, ctx) => SAFE_PROTOCOL.test(url) && ctx.defaultValidate(url),
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null },
    }),
    FaithfulCodeBlock,
    FaithfulOrderedList,
    FaithfulParagraph,
    FaithfulBlockquote,
    Callout,
    Toggle,
    ToggleTitle,
    FaithfulMarkdown.configure({ markedOptions: { gfm: true } }),
    TaskList,
    // What a screen reader says for each checkbox, in the app's language.
    FaithfulTaskItem.configure({
      nested: true,
      a11y: { checkboxLabel: (node) => (node.textContent ? t('docs:editor.taskCheckbox', { text: node.textContent }) : t('docs:editor.taskCheckboxEmpty')) },
    }),
    TableKit.configure({ table: false }),
    FaithfulTable.configure({ resizable: false }),
    FaithfulImage,
    FaithfulInlineMath,
    FaithfulBlockMath,
    RawHtmlBlock,
    RawHtmlInline,
    RawMarkdownBlock,
    RawMarkdownInline,
    DocumentRules,
  ]
}
