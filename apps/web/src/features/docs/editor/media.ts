import { type AttachmentDTO, type MediaKind, attachmentIdOf, mediaKind } from '@orqevio/shared'
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { t } from 'i18next'

/**
 * Video and audio attached here, played where they are linked: a paragraph that holds only a link
 * to one (`[clip.mp4](/api/attachments/<id>)`, as the editor puts a file) shows its player under the
 * link. The Markdown stays the link, which GitHub shows as one. Only this copy's own attachments, by
 * the type the server keeps for them: nothing from another site is ever played.
 */

/** The attachments that are played, by id. */
export type Playable = ReadonlyMap<string, MediaKind>

/** Which of `attachments` are played, and as what. */
export function playable(attachments: readonly AttachmentDTO[]): Map<string, MediaKind> {
  const known = new Map<string, MediaKind>()
  for (const attachment of attachments) {
    const kind = mediaKind(attachment.mimeType)
    if (kind) known.set(attachment.id, kind)
  }
  return known
}

/** What a link to `href` plays, if it leads to one of `known`. */
const kindOf = (href: string | null, known: Playable) => {
  const id = href && attachmentIdOf(href)
  return (id && known.get(id)) || null
}

/** A player of `src`, named `name`; one the browser can't play hides, and its link stays. */
export function player(kind: MediaKind, src: string, name: string) {
  const box = document.createElement('span')
  box.className = 'orq-media'
  box.dataset.media = kind
  box.contentEditable = 'false'
  const media = document.createElement(kind)
  media.controls = true
  media.preload = 'metadata'
  // On an iPhone, in its place rather than full screen.
  if (kind === 'video') media.setAttribute('playsinline', '')
  media.setAttribute('aria-label', t(`docs:editor.media.${kind}`, { name }))
  media.addEventListener('error', () => box.setAttribute('data-error', ''))
  media.src = src
  box.append(media)
  return box
}

/** The address a paragraph links to with all its text, if it does: a file put on a line of its own. */
export function linkedAlone(paragraph: PMNode) {
  if (paragraph.type.name !== 'paragraph' || paragraph.childCount === 0) return null
  let href: string | null = null
  for (let i = 0; i < paragraph.childCount; i++) {
    const child = paragraph.child(i)
    const link = child.isText ? child.marks.find((mark) => mark.type.name === 'link') : undefined
    const to = link ? String(link.attrs.href ?? '') : ''
    if (!to || (href !== null && to !== href)) return null
    href = to
  }
  return href
}

interface MediaState {
  known: Playable
  decorations: DecorationSet
}

export const mediaKey = new PluginKey<MediaState>('attachmentMedia')

function decorate(doc: PMNode, known: Playable) {
  if (known.size === 0) return DecorationSet.empty
  const players: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return !node.isTextblock
    const href = linkedAlone(node)
    const kind = kindOf(href, known)
    if (!kind || !href) return false
    const name = node.textContent
    // At the end of its line, after the link. Drawn again only when what it plays changes, so that
    // one playing keeps playing while the page is written.
    players.push(
      Decoration.widget(pos + 1 + node.content.size, () => player(kind, href, name), {
        side: 1,
        key: `${kind}\u0000${href}\u0000${name}`,
        ignoreSelection: true,
        // Its controls are its own: a press on them doesn't place the cursor.
        stopEvent: () => true,
      }),
    )
    return false
  })
  return DecorationSet.create(doc, players)
}

/** Tells the editor which attachments are played: those of what it edits, and those uploaded since. */
export function setPlayable(view: EditorView, known: Playable) {
  view.dispatch(view.state.tr.setMeta(mediaKey, known).setMeta('addToHistory', false))
}

export const AttachmentMedia = Extension.create({
  name: 'attachmentMedia',
  addProseMirrorPlugins() {
    return [
      new Plugin<MediaState>({
        key: mediaKey,
        state: {
          init: () => ({ known: new Map(), decorations: DecorationSet.empty }),
          apply: (tr, value, _old, state) => {
            const known = (tr.getMeta(mediaKey) as Playable | undefined) ?? value.known
            if (!tr.docChanged && known === value.known) return value
            return { known, decorations: decorate(state.doc, known) }
          },
        },
        props: {
          decorations: (state) => mediaKey.getState(state)?.decorations,
        },
      }),
    ]
  },
})

/**
 * Shows the players of Markdown shown, not edited (a comment): after each link to one of `known`
 * that is alone on its line. Once per link, however many times it is called.
 */
export function showPlayers(root: ParentNode | null, known: Playable) {
  if (!root || known.size === 0) return
  for (const line of root.querySelectorAll('p')) {
    const links = [...line.childNodes].filter((child) => !(child.nodeType === Node.TEXT_NODE && !child.textContent?.trim()))
    const [link] = links
    if (links.length !== 1 || !(link instanceof HTMLAnchorElement) || line.querySelector('.orq-media')) continue
    const href = link.getAttribute('href')
    const kind = kindOf(href, known)
    if (kind && href) line.append(player(kind, href, link.textContent ?? ''))
  }
}
