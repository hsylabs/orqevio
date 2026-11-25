import type { Editor } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import type { NodeView } from '@tiptap/pm/view'
import i18next, { t } from 'i18next'
import { ownStep } from './own-step'

/**
 * Images, with a size and a caption that GitHub reads too:
 * - without a size, `![alt](src "caption")` as before;
 * - with one, the `<img>` tag GitHub sizes: `<img src="…" alt="…" width="50%">`;
 * - an `<img>` tag already in a page is an image too, kept as written: only the attributes changed
 *   in the editor are written anew.
 * The caption is the image's title: shown under it in Orqevio, and over it on GitHub.
 */

export const escapeAlt = (alt: string) => alt.replace(/([\\[\]])/g, '\\$1')
export const destination = (src: string) => (/[\s()<>]/.test(src) ? `<${src.replace(/([<>])/g, '\\$1')}>` : src)

/** A size as `width` and `height` take it: pixels, or a share of the line. */
const SIZE = /^\d{1,5}(?:\.\d+)?(?:px|%)?$/i
/** An attribute of a tag, as CommonMark reads raw HTML. */
const ATTRIBUTE = String.raw`[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>\x60]+|'[^']*'|"[^"]*"))?`
const TAG = new RegExp(String.raw`^<img((?:\s+${ATTRIBUTE})*)(\s*\/?>)$`, 'i')
const ONE = new RegExp(String.raw`(\s+)(${ATTRIBUTE})`, 'g')
const NAME_VALUE = /^([A-Za-z_:][\w.:-]*)(?:\s*=\s*(?:([^\s"'=<>`]+)|'([^']*)'|"([^"]*)"))?$/

/** What an image of the editor holds. `html` is the `<img>` tag it was read from, if any. */
export interface ImageAttributes {
  src: string
  alt: string | null
  title: string | null
  width: string | null
  height: string | null
  html?: string | null
}

let decoder: HTMLTextAreaElement | null = null
/** An attribute's value as the browser reads it: its entities decoded. */
function decode(value: string) {
  if (!value.includes('&')) return value
  if (typeof document === 'undefined') return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  decoder ??= document.createElement('textarea')
  decoder.innerHTML = value
  return decoder.value
}

/** A value written in a tag, between double quotes. */
const quoted = (value: string) => `"${value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"`

/** The attributes of an `<img>` tag, in order, each with how it was written. */
function attributesOf(tag: string) {
  const match = TAG.exec(tag)
  if (!match) return null
  const list: Array<{ space: string; raw: string; name: string; value: string | null }> = []
  for (const one of match[1]!.matchAll(ONE)) {
    const parts = NAME_VALUE.exec(one[2]!)!
    const value = parts[2] ?? parts[3] ?? parts[4]
    list.push({ space: one[1]!, raw: one[2]!, name: parts[1]!.toLowerCase(), value: value === undefined ? null : decode(value) })
  }
  return { list, end: match[2]! }
}

/** An address an image can be loaded from: on the web, or on this copy. Anything else stays HTML. */
const loadable = (src: string) => !/^[a-z][a-z0-9+.-]*:/i.test(src.trim()) || /^https?:/i.test(src.trim())

/** The image an `<img>` tag alone is, or null for any other HTML. */
export function imageFromTag(html: string): ImageAttributes | null {
  const tag = attributesOf(html.trim())
  if (!tag) return null
  const get = (name: string) => tag.list.find((attribute) => attribute.name === name)?.value ?? null
  const src = get('src')
  if (!src || !loadable(src)) return null
  const size = (value: string | null) => (value !== null && SIZE.test(value.trim()) ? value.trim() : null)
  return { src, alt: get('alt'), title: get('title'), width: size(get('width')), height: size(get('height')), html: html.trim() }
}

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? null) === (b ?? null)

/** The `<img>` tag an image was read from, with the attributes changed since then written anew. */
function retag(attrs: ImageAttributes) {
  const html = attrs.html!
  const was = imageFromTag(html)
  const tag = attributesOf(html)
  if (!was || !tag) return newTag(attrs)
  const changes = new Map<string, string | null>()
  for (const name of ['src', 'alt', 'title', 'width', 'height'] as const) if (!same(was[name], attrs[name])) changes.set(name, attrs[name] ?? null)
  if (!changes.size) return html
  // A new width, and the height it had would stretch it: the image keeps its proportions.
  if (changes.has('width') && !changes.has('height')) changes.set('height', null)
  let out = '<img'
  for (const attribute of tag.list) {
    if (!changes.has(attribute.name)) out += attribute.space + attribute.raw
    else {
      const value = changes.get(attribute.name)
      changes.delete(attribute.name)
      if (value !== null && value !== undefined) out += `${attribute.space}${attribute.name}=${quoted(value)}`
    }
  }
  for (const [name, value] of changes) if (value !== null && value !== undefined && (name !== 'alt' || value !== '')) out += ` ${name}=${quoted(value)}`
  return out + tag.end
}

/** An `<img>` tag for an image with a size, which Markdown can't give it. */
function newTag({ src, alt, title, width, height }: ImageAttributes) {
  return `<img src=${quoted(src)} alt=${quoted(alt ?? '')}${title ? ` title=${quoted(title)}` : ''}${width ? ` width=${quoted(width)}` : ''}${height ? ` height=${quoted(height)}` : ''}>`
}

/** An image as Markdown: its tag if it was read from one or has a size, `![alt](src "title")` otherwise. */
export function imageMarkdown(attrs: ImageAttributes) {
  if (attrs.html) return retag(attrs)
  if (attrs.width || attrs.height) return newTag(attrs)
  const { src, alt, title } = attrs
  return `![${escapeAlt(alt ?? '')}](${destination(src ?? '')}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`
}

/** A width as CSS: a share of the line, or pixels. */
export const cssSize = (value: string | null) => (!value ? '' : value.endsWith('%') ? value : `${parseFloat(value)}px`)

/** The narrowest an image is made by dragging its edge. */
const MIN_WIDTH = 48

/**
 * An image in the editor: the picture, its caption under it, and a handle on its right edge that
 * gives it a width by dragging, written as a share of the line it is on.
 */
class ImageView implements NodeView {
  dom: HTMLElement
  private img: HTMLImageElement
  private caption: HTMLElement
  private handle: HTMLElement
  private dragging = false

  constructor(
    private node: PMNode,
    private editor: Editor,
    private getPos: () => number | undefined,
  ) {
    this.dom = document.createElement('span')
    this.dom.className = 'orq-image'
    this.img = document.createElement('img')
    this.img.draggable = false
    this.caption = document.createElement('span')
    this.caption.className = 'orq-image-caption'
    this.handle = document.createElement('span')
    this.handle.className = 'orq-image-handle'
    this.handle.setAttribute('aria-hidden', 'true')
    this.dom.append(this.img, this.caption, this.handle)
    this.handle.addEventListener('pointerdown', this.resize)
    i18next.on('languageChanged', this.label)
    this.render()
  }

  private label = () => {
    this.handle.title = t('docs:editor.image.resize')
  }

  private render() {
    const { src, alt, title, width, height } = this.node.attrs as ImageAttributes
    if (this.img.getAttribute('src') !== src) this.img.setAttribute('src', src)
    this.img.alt = alt ?? ''
    this.dom.style.width = cssSize(width)
    this.dom.toggleAttribute('data-sized', !!width)
    this.img.style.height = !width && height ? cssSize(height) : ''
    this.caption.textContent = title ?? ''
    this.caption.hidden = !title
    this.label()
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    if (!this.dragging) this.render()
    return true
  }

  /** Dragging the handle: the width follows the pointer, and is saved once, as one step, on letting go. */
  private resize = (event: PointerEvent) => {
    if (!this.editor.isEditable || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const line = this.dom.parentElement
    const room = line?.clientWidth || this.dom.getBoundingClientRect().width
    const start = event.clientX
    const from = this.dom.getBoundingClientRect().width
    let width = from
    this.dragging = true
    this.dom.setAttribute('data-resizing', '')
    this.handle.setPointerCapture?.(event.pointerId)
    const move = (e: PointerEvent) => {
      width = Math.max(MIN_WIDTH, Math.min(room, from + e.clientX - start))
      this.dom.style.width = `${width}px`
    }
    const done = () => {
      this.handle.removeEventListener('pointermove', move)
      this.handle.removeEventListener('pointerup', done)
      this.handle.removeEventListener('pointercancel', done)
      this.dragging = false
      this.dom.removeAttribute('data-resizing')
      const pos = this.getPos()
      if (pos === undefined || Math.abs(width - from) < 2) return this.render()
      // Dragged with the pointer, the editor takes the focus, with the image selected and its bar.
      setImageWidth(this.editor, pos, `${Math.max(1, Math.min(100, Math.round((width / room) * 100)))}%`, { focus: true })
    }
    this.handle.addEventListener('pointermove', move)
    this.handle.addEventListener('pointerup', done)
    this.handle.addEventListener('pointercancel', done)
  }

  // Its handle is its own: the editor neither selects nor drags anything from there.
  stopEvent(event: Event) {
    return event.target instanceof globalThis.Node && this.handle.contains(event.target)
  }

  // What it draws is its own; the editor reads nothing in it.
  ignoreMutation() {
    return true
  }

  destroy() {
    this.handle.removeEventListener('pointerdown', this.resize)
    i18next.off('languageChanged', this.label)
  }
}

/** The image at `pos` with another width (null: its own size), as one step; it stays selected. */
export function setImageWidth(editor: Editor, pos: number, width: string | null, { focus = false } = {}) {
  const node = editor.state.doc.nodeAt(pos)
  if (node?.type.name !== 'image' || (node.attrs.width === width && (width !== null || !node.attrs.height))) return false
  return ownStep(
    editor,
    ({ tr }) => {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, width, height: null })
      tr.setSelection(NodeSelection.create(tr.doc, pos))
      return true
    },
    { focus },
  )
}

/** The image at `pos` with another caption (empty: none), as one step. */
export function setImageCaption(editor: Editor, pos: number, caption: string) {
  const node = editor.state.doc.nodeAt(pos)
  const title = caption.replace(/\s+/g, ' ').trim() || null
  if (node?.type.name !== 'image' || same(node.attrs.title, title)) return false
  return ownStep(
    editor,
    ({ tr }) => {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, title })
      tr.setSelection(NodeSelection.create(tr.doc, pos))
      return true
    },
    { focus: false },
  )
}

export const FaithfulImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // The tag it was read from, written back as it was; no part of its HTML.
      html: { default: null, rendered: false, parseHTML: () => null },
    }
  },

  parseHTML() {
    return [
      ...(this.parent?.() ?? []),
      // The caption shown under an image outside the editor (markdown-html.ts) is its title, no text of the page.
      { tag: 'span.orq-image-caption', ignore: true },
    ]
  },

  renderMarkdown: (node) => {
    const image = imageMarkdown((node.attrs ?? {}) as ImageAttributes)
    // A linked image, such as a badge: @tiptap/markdown writes marks on text only.
    const link = node.marks?.find((m) => m.type === 'link')
    return link?.attrs?.href ? `[${image}](${destination(String(link.attrs.href))})` : image
  },

  addNodeView() {
    return ({ node, editor, getPos }) => new ImageView(node, editor, getPos)
  },
}).configure({ inline: true, allowBase64: false })
