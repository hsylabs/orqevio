import { type AnyExtension, type JSONContent, Node } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Paragraph from '@tiptap/extension-paragraph'
import { TableKit } from '@tiptap/extension-table'
import { Markdown, MarkdownManager, assumeContentType } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { t } from 'i18next'

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

const escapeAlt = (alt: string) => alt.replace(/([\\[\]])/g, '\\$1')
const destination = (src: string) => (/[\s()<>]/.test(src) ? `<${src.replace(/([<>])/g, '\\$1')}>` : src)

const FaithfulImage = Image.extend({
  renderMarkdown: (node) => {
    const { src = '', alt = '', title = '' } = (node.attrs ?? {}) as { src?: string; alt?: string; title?: string }
    const image = `![${escapeAlt(alt ?? '')}](${destination(src ?? '')}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`
    // A linked image, such as a badge: @tiptap/markdown writes marks on text only.
    const link = node.marks?.find((m) => m.type === 'link')
    return link?.attrs?.href ? `[${image}](${destination(String(link.attrs.href))})` : image
  },
}).configure({ inline: true, allowBase64: false })

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
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        isAllowedUri: (url, ctx) => SAFE_PROTOCOL.test(url) && ctx.defaultValidate(url),
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null },
      },
    }),
    FaithfulParagraph,
    FaithfulMarkdown.configure({ markedOptions: { gfm: true } }),
    TaskList,
    // What a screen reader says for each checkbox, in the app's language.
    TaskItem.configure({
      nested: true,
      a11y: { checkboxLabel: (node) => (node.textContent ? t('docs:editor.taskCheckbox', { text: node.textContent }) : t('docs:editor.taskCheckboxEmpty')) },
    }),
    TableKit.configure({ table: { resizable: false } }),
    FaithfulImage,
    RawHtmlBlock,
    RawHtmlInline,
  ]
}
