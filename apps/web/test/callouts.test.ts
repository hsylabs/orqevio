// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { removeCallout, setCalloutType, turnBlock, turns } from '../src/features/docs/editor/block-commands'
import { documentExtensions } from '../src/features/docs/editor/markdown'
import { markdownToHtml } from '../src/features/docs/editor/markdown-html'

// GitHub's alerts are callouts in the editor: a box with their type, written back as the quote they were.
const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))

function open(content: string, contentType: 'markdown' | 'html' = 'markdown') {
  const editor = new Editor({ extensions: documentExtensions(), content, contentType })
  editors.push(editor)
  return editor
}
const types = (editor: Editor) => editor.getJSON().content?.map((node) => node.type)
const first = (editor: Editor, name: string) => {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === name) found = pos
    return found === -1
  })
  return found
}

describe('a GitHub alert', () => {
  const alerts: Array<[string, string]> = [
    ['one line under its marker', '> [!NOTE]\n> Hola'],
    ['several lines, and a paragraph after a blank line', '> [!WARNING]\n> Uno\n> dos\n>\n> Tres'],
    ['a blank line after its marker', '> [!TIP]\n>\n> Tras hueco'],
    ['only its marker', '> [!IMPORTANT]'],
    ['its marker in small letters', '> [!caution]\n> minúsculas'],
    ['a list right under its marker', '> [!NOTE]\n> - uno\n> - dos'],
    ['formatting, a link and code', '> [!CAUTION]\n> **Ojo** con [esto](https://a.test)\n>\n> ```js\n> x\n> ```'],
    ['text around it', 'Antes\n\n> [!IMPORTANT]\n> Uno\n\nDespués'],
    ['two in a row', '> [!NOTE]\n> Uno\n\n> [!TIP]\n> Dos'],
    ['one inside another', '> [!NOTE]\n> Fuera\n>\n> > [!TIP]\n> > Dentro'],
  ]

  it.each(alerts)('is a callout, written back as it was: %s', (_name, markdown) => {
    const editor = open(markdown)
    expect(types(editor)).toContain('callout')
    expect(editor.getMarkdown()).toBe(markdown)
  })

  it.each([
    ['a title after its marker, as Obsidian writes them', '> [!tip] Título\n> Texto'],
    ['a marker that folds, as Obsidian writes them', '> [!NOTE]-\n> Texto'],
    ['a type GitHub does not have', '> [!INFO]\n> Texto'],
    ['a marker escaped on purpose', '> \\[!NOTE\\]\n> Así se escribe'],
    ['no marker', '> Una cita\n> normal'],
  ])('stays a quote with %s', (_name, markdown) => {
    const editor = open(markdown)
    expect(types(editor)).toEqual(['blockquote'])
    expect(editor.getMarkdown()).toBe(markdown)
  })
})

describe('a callout changed in the editor', () => {
  it('takes another type, in the case its marker was written in', () => {
    const upper = open('> [!NOTE]\n> Hola')
    setCalloutType(upper, first(upper, 'callout'), 'warning')
    expect(upper.getMarkdown().trimEnd()).toBe('> [!WARNING]\n> Hola')
    const lower = open('> [!note]\n> Hola')
    setCalloutType(lower, first(lower, 'callout'), 'tip')
    expect(lower.getMarkdown().trimEnd()).toBe('> [!tip]\n> Hola')
  })

  it('is made from text, a heading or a quote, and turned back into a quote or into what it held', () => {
    const editor = open('Texto\n\n> Cita')
    expect(turns(editor.state.doc, 0).options).toContain('callout')
    turnBlock(editor, 0, 'callout')
    const saved = () => editor.getMarkdown().trimEnd()
    expect(saved()).toBe('> [!NOTE]\n> Texto\n\n> Cita')
    const quote = first(editor, 'blockquote')
    turnBlock(editor, quote, 'callout')
    expect(saved()).toBe('> [!NOTE]\n> Texto\n\n> [!NOTE]\n> Cita')
    turnBlock(editor, first(editor, 'callout'), 'quote')
    expect(saved()).toBe('> Texto\n\n> [!NOTE]\n> Cita')
    removeCallout(editor, first(editor, 'callout'))
    expect(saved()).toBe('> Texto\n\nCita')
  })

  it('is written with only its marker while it is empty, and with its text once it has one', () => {
    const editor = open('')
    editor.commands.wrapIn('callout', { marker: '[!NOTE]' })
    expect(editor.getMarkdown().trim()).toBe('> [!NOTE]')
    editor.commands.insertContent('Hola')
    expect(editor.getMarkdown().trim()).toBe('> [!NOTE]\n> Hola')
  })
})

describe('a callout as HTML', () => {
  it('comes back the same through copy and paste', () => {
    for (const markdown of ['> [!note]\n> Hola', '> [!TIP]\n>\n> Tras hueco']) {
      expect(open(open(markdown).getHTML(), 'html').getMarkdown()).toBe(markdown)
    }
  })

  it('is read from an alert copied from GitHub, without GitHub\'s title', () => {
    const html = '<div class="markdown-alert markdown-alert-warning" dir="auto"><p class="markdown-alert-title" dir="auto"><svg></svg>Warning</p><p dir="auto">Cuidado con esto.</p></div>'
    expect(open(html, 'html').getMarkdown()).toBe('> [!WARNING]\n> Cuidado con esto.')
  })

  it('shows its icon and its type in a comment, and its content as it was', () => {
    const html = markdownToHtml('> [!WARNING]\n> **Ojo**')
    expect(html).toMatch(/^<blockquote data-marker="\[!WARNING\]" data-callout="warning" class="orq-callout orq-callout--warning"><div class="orq-callout-title"><span class="orq-callout-type"><svg[^>]*class="orq-callout-icon"/)
    expect(html).toContain('<p><strong>Ojo</strong></p>')
    expect(markdownToHtml('> [!tip] Título\n> Texto')).not.toContain('orq-callout')
  })
})
