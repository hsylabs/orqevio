import { type AnyExtension, type JSONContent, Node } from '@tiptap/core'
import Blockquote from '@tiptap/extension-blockquote'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import { ORDERED_LIST_MARKER_PATTERN, OrderedList, TaskItem, TaskList } from '@tiptap/extension-list'
import Paragraph from '@tiptap/extension-paragraph'
import { Table, TableKit } from '@tiptap/extension-table'
import { Markdown, MarkdownManager, assumeContentType } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { t } from 'i18next'
import { DocumentRules } from './block-commands'
import { Callout, calloutFromQuote } from './callout'
import { FaithfulCodeBlock } from './code-block'

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

/** CommonMark inline raw HTML: an open or closing tag, a comment, a processing instruction, a declaration or CDATA. */
const ATTRIBUTE = String.raw`\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>\x60]+|'[^']*'|"[^"]*"))?`
const INLINE_HTML = new RegExp(
  String.raw`^(?:<[A-Za-z][A-Za-z0-9-]*(?:${ATTRIBUTE})*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![A-Za-z][^>]*>|<!\[CDATA\[[\s\S]*?\]\]>)`,
)

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
  parseMarkdown: (token, helpers) => helpers.createNode('htmlInline', { html: String(token.raw ?? '') }),
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
    return escapeLineStarts(this.parent?.(node, helpers, context) ?? '')
  },
})

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

const escapeAlt = (alt: string) => alt.replace(/([\\[\]])/g, '\\$1')
const destination = (src: string) => (/[\s()<>]/.test(src) ? `<${src.replace(/([<>])/g, '\\$1')}>` : src)

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
    return `[${helpers.renderChildren(node)}](${address}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`
  },
})

// ── Ordered lists ────────────────────────────────────────────────

const ORDERED_ITEM = new RegExp(`^([ \\t]*)(${ORDERED_LIST_MARKER_PATTERN})([.)])( +)`)
const FENCE = /^(`{3,}|~{3,})/
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
 */
export function alignOrderedContinuations(src: string) {
  let item: { strippedThere: number; textColumn: number } | null = null
  /** The fence of a code block open under the item: its lines are code, whatever they look like. */
  let fence: { char: string; length: number } | null = null
  const protect = !src.includes(NOT_AN_ITEM)
  let aligned = ''
  let previousBlank = false
  // Line by line, up to where the list ends: the rest of the document is left as it is.
  for (let start = 0; start <= src.length; ) {
    const newline = src.indexOf('\n', start)
    const end = newline === -1 ? src.length : newline
    let line = src.slice(start, end)
    const lead = line.length - line.trimStart().length
    // A line less indented than the item's text closes a code block left open under it.
    if (fence && line.trim() && item && lead < item.textColumn) fence = null
    const match = fence ? null : ORDERED_ITEM.exec(line)
    if (match) {
      const [, indent = '', marker = '', , spaces = ''] = match
      // Five spaces or more after the marker: the text starts after one, and the rest is code.
      const gap = spaces.length > 4 ? 1 : spaces.length
      item = { strippedThere: indent.length + marker.length + 1, textColumn: indent.length + marker.length + 1 + gap }
    } else if (item && line.trim()) {
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
      if (!ORDERED_ITEM.test(end === -1 ? src : src.slice(0, end))) return orderedListTokenizer.tokenize(src, tokens, lexer)
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

const FaithfulImage = Image.extend({
  renderMarkdown: (node) => {
    const { src = '', alt = '', title = '' } = (node.attrs ?? {}) as { src?: string; alt?: string; title?: string }
    const image = `![${escapeAlt(alt ?? '')}](${destination(src ?? '')}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`
    // A linked image, such as a badge: @tiptap/markdown writes marks on text only.
    const link = node.marks?.find((m) => m.type === 'link')
    return link?.attrs?.href ? `[${image}](${destination(String(link.attrs.href))})` : image
  },
}).configure({ inline: true, allowBase64: false })

// ── Tables ───────────────────────────────────────────────────────

/**
 * A table of the document's top level, of a quote or of a callout is written without the blank lines
 * @tiptap/extension-table puts around it: blocks are already apart there. With them, two tables in a
 * row read back with an empty paragraph between them, one more on every save. In a list item they
 * hold its lines apart, and stay.
 */
const FaithfulTable = Table.extend({
  renderMarkdown(node, helpers, context) {
    const markdown = this.parent?.(node, helpers, context) ?? ''
    return ['doc', 'blockquote', 'callout'].includes(String(context.parentType)) ? markdown.replace(/^\n+|\n+$/g, '') : markdown
  },
})

// ── Markdown manager ─────────────────────────────────────────────

type Token = { type?: string; text?: string; raw?: string; tokens?: Token[] }
/** The private methods of MarkdownManager 3.33.0 patched below; the round-trip tests catch any change. */
interface ManagerInternals {
  codeTypes: Set<string>
  escapeMarkdownSyntax(text: string): string
  encodeTextForMarkdown(text: string, node: JSONContent, parentNode?: JSONContent): string
  parseInlineTokens(tokens: Token[]): JSONContent[]
  applyMarkToContent(markType: string, content: JSONContent[], attrs?: Record<string, unknown>): JSONContent[]
}

function faithfulManager(options: ConstructorParameters<typeof MarkdownManager>[0]) {
  const manager = new MarkdownManager(options)
  const internals = manager as unknown as ManagerInternals

  internals.encodeTextForMarkdown = (text, node, parentNode) => {
    const inCode =
      (parentNode?.type != null && internals.codeTypes.has(parentNode.type)) ||
      (node.marks ?? []).some((m) => internals.codeTypes.has(typeof m === 'string' ? m : m.type))
    return inCode ? text : encodeText(internals.escapeMarkdownSyntax(text))
  }

  // Front matter stays at the top as written; the rest is read as usual.
  const parse = manager.parse.bind(manager)
  manager.parse = (markdown: string) => {
    const front = FRONT_MATTER.exec(markdown)
    if (!front) return parse(markdown)
    const rest = parse(markdown.slice(front[0].length).replace(/^(?:[ \t]*\r?\n)+/, ''))
    return { ...rest, type: 'doc', content: [{ type: 'rawMarkdownBlock', attrs: { markdown: front[0] } }, ...(rest.content ?? [])] }
  }

  const parseInlineTokens = internals.parseInlineTokens.bind(manager)
  internals.parseInlineTokens = (tokens) =>
    parseInlineTokens(tokens.map((t) => (t.type === 'text' && t.text ? { ...t, text: decodeNamedEntities(t.text) } : t)))

  // Links around an image (a badge) stay on the image; marks only reach text otherwise.
  const applyMarkToContent = internals.applyMarkToContent.bind(manager)
  internals.applyMarkToContent = (markType, content, attrs) =>
    applyMarkToContent(markType, content, attrs).map((node, i) =>
      markType === 'link' && content[i]?.type === 'image' ? { ...node, marks: [...(node.marks ?? []), { type: markType, ...(attrs ? { attrs } : {}) }] } : node,
    )

  return manager
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
    }),
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
    FaithfulMarkdown.configure({ markedOptions: { gfm: true } }),
    TaskList,
    // What a screen reader says for each checkbox, in the app's language.
    TaskItem.configure({
      nested: true,
      a11y: { checkboxLabel: (node) => (node.textContent ? t('docs:editor.taskCheckbox', { text: node.textContent }) : t('docs:editor.taskCheckboxEmpty')) },
    }),
    TableKit.configure({ table: false }),
    FaithfulTable.configure({ resizable: false }),
    FaithfulImage,
    RawHtmlBlock,
    RawHtmlInline,
    RawMarkdownBlock,
    RawMarkdownInline,
    DocumentRules,
  ]
}
