// @vitest-environment jsdom
import type { AttachmentDTO } from '@orqevio/shared'
import { Editor } from '@tiptap/core'
import i18next from 'i18next'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import docs from '../src/i18n/locales/es/docs.json'
import { documentExtensions } from '../src/features/docs/editor/markdown'
import { markdownToHtml } from '../src/features/docs/editor/markdown-html'
import { AttachmentMedia, playable, setPlayable, showPlayers } from '../src/features/docs/editor/media'

// A video or a sound attached here plays where it is linked, alone on its line, as Notion plays
// one; its Markdown stays the link, which GitHub shows as one. Only this copy's own attachments.

const VIDEO = '11111111-1111-4111-8111-111111111111'
const SOUND = '22222222-2222-4222-8222-222222222222'
const PDF = '33333333-3333-4333-8333-333333333333'

const attachment = (id: string, filename: string, mimeType: string): AttachmentDTO => ({
  id,
  filename,
  mimeType,
  size: 10,
  url: `/api/attachments/${id}`,
  isImage: false,
  createdAt: '2026-11-28T00:00:00.000Z',
})
const ATTACHMENTS = [attachment(VIDEO, 'clip.mp4', 'video/mp4'), attachment(SOUND, 'nota.m4a', 'audio/x-m4a'), attachment(PDF, 'informe.pdf', 'application/pdf')]

beforeAll(async () => {
  await i18next.init({ lng: 'es', resources: { es: { docs } }, ns: ['docs'] })
})

const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))

function open(content: string) {
  const element = document.body.appendChild(document.createElement('div'))
  const editor = new Editor({ element, extensions: [...documentExtensions(), AttachmentMedia], content, contentType: 'markdown' })
  editors.push(editor)
  setPlayable(editor.view, playable(ATTACHMENTS))
  return editor
}
const players = (root: ParentNode) => [...root.querySelectorAll('.orq-media')].map((box) => {
  const media = box.querySelector('video, audio')!
  return { kind: media.localName, src: media.getAttribute('src'), name: media.getAttribute('aria-label'), controls: media.hasAttribute('controls') }
})

describe('which attachments are played', () => {
  it('video and audio browsers play, by the type the server keeps; nothing else', () => {
    expect([...playable(ATTACHMENTS)]).toEqual([
      [VIDEO, 'video'],
      [SOUND, 'audio'],
    ])
  })
})

describe('in the editor', () => {
  it('a link to one, alone on its line, plays under it; its Markdown stays the link', () => {
    const markdown = `Antes\n\n[clip.mp4](/api/attachments/${VIDEO})\n\n[nota.m4a](/api/attachments/${SOUND})`
    const editor = open(markdown)
    expect(players(editor.view.dom)).toEqual([
      { kind: 'video', src: `/api/attachments/${VIDEO}`, name: 'Vídeo: clip.mp4', controls: true },
      { kind: 'audio', src: `/api/attachments/${SOUND}`, name: 'Audio: nota.m4a', controls: true },
    ])
    // Under its link, in its own line.
    expect(editor.view.dom.querySelector('.orq-media')!.parentElement!.querySelector('a')?.textContent).toBe('clip.mp4')
    expect(editor.getMarkdown()).toBe(markdown)
  })

  it('plays nothing that isn\'t alone on its line, isn\'t played, or isn\'t one of this copy\'s', () => {
    const editor = open(
      [
        `Mira [clip.mp4](/api/attachments/${VIDEO}) aquí`,
        `[informe.pdf](/api/attachments/${PDF})`,
        `[otro](/api/attachments/44444444-4444-4444-8444-444444444444)`,
        `[clip.mp4](https://example.com/api/attachments/${VIDEO})`,
        `[clip.mp4](/api/attachments/${VIDEO}/x)`,
        `[clip](/api/attachments/${VIDEO}) [clip](/api/attachments/${SOUND})`,
        '```\n[clip.mp4](/api/attachments/' + VIDEO + ')\n```',
      ].join('\n\n'),
    )
    expect(players(editor.view.dom)).toEqual([])
  })

  it('in a list, a quote or a toggle too, and with its name in bold', () => {
    const editor = open(
      [`- [clip.mp4](/api/attachments/${VIDEO})`, `> [nota.m4a](/api/attachments/${SOUND})`, `[**clip**](/api/attachments/${VIDEO})`].join('\n\n'),
    )
    expect(players(editor.view.dom).map((player) => player.kind)).toEqual(['video', 'audio', 'video'])
  })

  it('is the same player while the page is written: one playing keeps playing', () => {
    const editor = open(`Antes\n\n[clip.mp4](/api/attachments/${VIDEO})`)
    const before = editor.view.dom.querySelector('video')
    editor.commands.insertContentAt(1, 'Ya ')
    expect(editor.view.dom.querySelector('video')).toBe(before)
    // Its name changed: drawn again, with it.
    const end = editor.state.doc.content.size - 1
    editor.commands.insertContentAt(end, { type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: `/api/attachments/${VIDEO}` } }] })
    expect(players(editor.view.dom)[0]?.name).toBe('Vídeo: clip.mp4x')
  })

  it('appears once its attachment is known, as one just uploaded, and goes with the link', () => {
    const editor = open(`[clip.mp4](/api/attachments/${VIDEO})`)
    setPlayable(editor.view, new Map())
    expect(players(editor.view.dom)).toEqual([])
    setPlayable(editor.view, playable(ATTACHMENTS))
    expect(players(editor.view.dom)).toHaveLength(1)
    // Knowing them is no change to the page, nor a step to undo.
    expect(editor.can().undo()).toBe(false)
    editor.commands.setContent('Nada')
    expect(players(editor.view.dom)).toEqual([])
  })

  it('one the browser can\'t play hides, and its link stays', () => {
    const editor = open(`[clip.mp4](/api/attachments/${VIDEO})`)
    const box = editor.view.dom.querySelector<HTMLElement>('.orq-media')!
    box.querySelector('video')!.dispatchEvent(new Event('error'))
    expect(box.hasAttribute('data-error')).toBe(true)
    expect(editor.view.dom.querySelector('a')?.textContent).toBe('clip.mp4')
  })
})

describe('shown, not edited (a comment)', () => {
  it('plays under the link alone on its line, once however often it is shown', () => {
    const root = document.createElement('div')
    root.innerHTML = markdownToHtml(`Así queda:\n\n[clip.mp4](/api/attachments/${VIDEO})\n\nY [nota.m4a](/api/attachments/${SOUND}) aquí\n\n[informe.pdf](/api/attachments/${PDF})`)
    const known = playable(ATTACHMENTS)
    showPlayers(root, known)
    showPlayers(root, known)
    expect(players(root)).toEqual([{ kind: 'video', src: `/api/attachments/${VIDEO}`, name: 'Vídeo: clip.mp4', controls: true }])
    expect(root.querySelector('.orq-media')!.previousElementSibling?.textContent).toBe('clip.mp4')
  })
})
