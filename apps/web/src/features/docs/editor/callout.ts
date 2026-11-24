import { type Editor, type JSONContent, Node, mergeAttributes } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'
import i18next, { t } from 'i18next'
import { type IconName, icon } from './svg-icons'

/**
 * Callouts are GitHub's alerts: a quote whose first line is only `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`,
 * `[!WARNING]` or `[!CAUTION]`. The editor shows them as a box with an icon and the type's name,
 * the marker kept as written in an attribute; their Markdown is the quote it was. Anything else
 * with a marker (an Obsidian callout with a title, a marker escaped on purpose) stays a quote.
 */

export const CALLOUT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'] as const
export type CalloutType = (typeof CALLOUT_TYPES)[number]

export const CALLOUT_ICONS: Record<CalloutType, IconName> = { note: 'info', tip: 'lightbulb', important: 'messageWarning', warning: 'triangleAlert', caution: 'octagonAlert' }

/** GitHub's marker alone on its line, in any case: GitHub reads `[!note]` as well. */
const MARKER = /^\[!(note|tip|important|warning|caution)\]$/i

export const calloutType = (marker: unknown): CalloutType => (MARKER.exec(String(marker ?? ''))?.[1]?.toLowerCase() as CalloutType | undefined) ?? 'note'

/** The marker of a type, in the case the block's was written in: GitHub's capitals, or small letters if it had them. */
export function markerFor(type: CalloutType, was?: unknown) {
  return `[!${typeof was === 'string' && /^\[![a-z]+\]$/.test(was) ? type : type.toUpperCase()}]`
}

/**
 * A quote read from Markdown that is one of GitHub's alerts, as a callout: what follows the marker's
 * line is its content. `gap` says a blank line came right after the marker, to write it back.
 */
export function calloutFromQuote(quote: JSONContent, gap: boolean): JSONContent | null {
  if (quote.attrs?.escapedMarker) return null
  const [first, ...rest] = quote.content ?? []
  if (first?.type !== 'paragraph') return null
  const [text, ...inline] = first.content ?? []
  if (text?.type !== 'text' || !text.text || text.marks?.length) return null
  const newline = text.text.indexOf('\n')
  const line = newline === -1 ? text.text : text.text.slice(0, newline)
  if (!MARKER.test(line)) return null
  let content: JSONContent[]
  if (newline === -1) {
    // More on the marker's line (a bold title, a link): not GitHub's form.
    if (inline.length) return null
    content = rest
  } else {
    // The lines after the marker's are the rest of its paragraph.
    const after = text.text.slice(newline + 1)
    const paragraph = [...(after ? [{ ...text, text: after }] : []), ...inline]
    content = paragraph.length ? [{ ...first, content: paragraph }, ...rest] : rest
  }
  return {
    type: 'callout',
    attrs: { marker: line, gap: newline === -1 && gap && content.length > 0 },
    content: content.length ? content : [{ type: 'paragraph' }],
  }
}

/** The name of a callout's type, in the app's language. */
export const calloutName = (type: CalloutType) => t(`docs:editor.callout.${type}`)

export interface CalloutStorage {
  /** Opens the menu of types of the callout at `pos` (CalloutControls). */
  openTypes: ((pos: number) => void) | null
}

export const calloutStorage = (editor: Editor) => (editor.storage as unknown as { callout?: CalloutStorage }).callout

/** A callout in the editor: a box with its icon, and its type's name as a button that opens the menu of types. */
class CalloutView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private title: HTMLElement
  private button: HTMLButtonElement

  constructor(
    private node: PMNode,
    private editor: Editor,
    private getPos: () => number | undefined,
  ) {
    this.dom = document.createElement('div')
    this.title = document.createElement('div')
    this.title.className = 'orq-callout-title'
    this.title.contentEditable = 'false'
    this.button = document.createElement('button')
    this.button.type = 'button'
    this.button.className = 'orq-callout-type'
    this.button.setAttribute('aria-haspopup', 'menu')
    this.button.setAttribute('aria-expanded', 'false')
    this.title.append(this.button)
    this.contentDOM = document.createElement('div')
    this.contentDOM.className = 'orq-callout-body'
    this.dom.append(this.title, this.contentDOM)
    // A press on its title leaves the cursor and the focus where they were, in the editor.
    this.button.addEventListener('mousedown', (event) => event.preventDefault())
    this.button.addEventListener('click', () => {
      const pos = this.getPos()
      if (pos !== undefined && this.editor.isEditable) calloutStorage(this.editor)?.openTypes?.(pos)
    })
    i18next.on('languageChanged', this.render)
    this.render()
  }

  private render = () => {
    const type = calloutType(this.node.attrs.marker)
    this.dom.className = `orq-callout orq-callout--${type}`
    this.dom.setAttribute('data-callout', type)
    const name = document.createElement('span')
    name.textContent = calloutName(type)
    this.button.replaceChildren(icon(CALLOUT_ICONS[type], 'orq-callout-icon'), name, icon('chevron', 'orq-callout-chevron'))
    this.button.setAttribute('aria-label', t('docs:editor.callout.typeOf', { type: name.textContent }))
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    const changed = node.attrs.marker !== this.node.attrs.marker
    this.node = node
    if (changed) this.render()
    return true
  }

  // Its title is its own: the editor neither selects nor reads anything there.
  stopEvent(event: Event) {
    return event.target instanceof globalThis.Node && this.title.contains(event.target)
  }

  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: globalThis.Node }) {
    return this.title.contains(mutation.target)
  }

  destroy() {
    i18next.off('languageChanged', this.render)
  }
}

export const Callout = Node.create<object, CalloutStorage>({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addStorage() {
    return { openTypes: null }
  },

  addAttributes() {
    return {
      // As written: `[!NOTE]`, or `[!note]`.
      marker: {
        default: '[!NOTE]',
        // Ours (copied and pasted), or GitHub's alert by its class.
        parseHTML: (element) => {
          const marker = element.getAttribute('data-marker') ?? ''
          if (MARKER.test(marker)) return marker
          const type = element.getAttribute('data-callout') ?? CALLOUT_TYPES.find((name) => element.classList.contains(`markdown-alert-${name}`))
          return type ? markerFor(calloutType(`[!${type}]`)) : null
        },
        renderHTML: (attributes) => ({ 'data-marker': attributes.marker }),
      },
      gap: {
        default: false,
        parseHTML: (element) => element.hasAttribute('data-gap'),
        renderHTML: (attributes) => (attributes.gap ? { 'data-gap': '' } : {}),
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'blockquote[data-callout]', priority: 60 },
      // An alert copied from a page of GitHub: its title is GitHub's, not text of the alert.
      {
        tag: 'div.markdown-alert',
        priority: 60,
        getAttrs: (element) => (CALLOUT_TYPES.some((name) => element.classList.contains(`markdown-alert-${name}`)) ? null : false),
        contentElement: (element) => {
          const copy = element.cloneNode(true) as HTMLElement
          copy.querySelector('.markdown-alert-title')?.remove()
          return copy
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const type = calloutType(node.attrs.marker)
    return ['blockquote', mergeAttributes(HTMLAttributes, { 'data-callout': type, class: `orq-callout orq-callout--${type}` }), 0]
  },

  // The quote it was, as the editor's quotes are written: each line after `> `, blocks apart by `>`.
  renderMarkdown: (node, helpers) => {
    const marker = String(node.attrs?.marker ?? '[!NOTE]')
    const content = node.content ?? []
    const empty = content.length === 1 && content[0]!.type === 'paragraph' && !content[0]!.content?.length
    if (!content.length || empty) return `> ${marker}`
    const body = content
      .map((child, index) =>
        (helpers.renderChild?.(child, index) ?? helpers.renderChildren([child]))
          .split('\n')
          .map((line) => (line.trim() === '' ? '>' : `> ${line}`))
          .join('\n'),
      )
      .join('\n>\n')
    return `> ${marker}\n${node.attrs?.gap ? '>\n' : ''}${body}`
  },

  addNodeView() {
    return ({ node, editor, getPos }) => new CalloutView(node, editor, getPos)
  },
})
