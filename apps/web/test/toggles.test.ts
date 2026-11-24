// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { undoDepth } from '@tiptap/pm/history'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import { turnBlock, turns } from '../src/features/docs/editor/block-commands'
import { documentExtensions } from '../src/features/docs/editor/markdown'
import { markdownToHtml } from '../src/features/docs/editor/markdown-html'
import { insertToggle, setToggleOpen } from '../src/features/docs/editor/toggle'

// HTML's <details> as a toggle in the editor: a title that shows or hides what is under it, written
// back as the HTML and Markdown it was.
const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))

function open(content: string, contentType: 'markdown' | 'html' = 'markdown', mounted = false) {
  const element = mounted ? document.body.appendChild(document.createElement('div')) : undefined
  const editor = new Editor({ element, extensions: documentExtensions(), content, contentType })
  editors.push(editor)
  return editor
}
const types = (editor: Editor) => {
  const found: string[] = []
  editor.state.doc.descendants((node) => void found.push(node.type.name))
  return found
}
const first = (editor: Editor, name: string) => {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === name) found = pos
    return found === -1
  })
  return found
}
const saved = (editor: Editor) => editor.getMarkdown().trimEnd()
/** A key pressed in the editor, as the browser sends it: its commands move the cursor too. */
const press = (editor: Editor, key: string, mod = false) =>
  editor.view.someProp('handleKeyDown', (handle) => handle(editor.view, new KeyboardEvent('keydown', { key, ctrlKey: mod, metaKey: false, bubbles: true })))
const cursorIn = (editor: Editor, name: string, at: 'start' | 'end' = 'end') => {
  const pos = first(editor, name)
  const node = editor.state.doc.nodeAt(pos)!
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at === 'start' ? pos + 1 : pos + node.nodeSize - 1)))
}

describe('a <details> with its summary', () => {
  it.each([
    ['as GitHub writes it', '<details>\n<summary>Más</summary>\n\nDentro **negrita**\n\n</details>'],
    ['open', '<details open>\n<summary>Abierto</summary>\n\n- uno\n- dos\n\n</details>'],
    ['on one line', '<details><summary>Una línea</summary>\n\nTexto\n\n</details>'],
    ['with a tag in its summary', '<details>\n  <summary><b>Con etiqueta</b></summary>\n\nTexto\n\n</details>'],
    ['with an entity in its summary', 'Antes\n\n<details>\n<summary>A &amp; B</summary>\n\nTexto\n\n</details>\n\nDespués'],
    ['empty', '<details>\n<summary>Vacío</summary>\n\n</details>'],
    ['inside another', '<details>\n<summary>Fuera</summary>\n\n<details>\n<summary>Dentro</summary>\n\nHondo\n\n</details>\n\n</details>'],
    ['in a quote', '> <details>\n> <summary>En cita</summary>\n>\n> Texto\n>\n> </details>'],
    ['with code and a callout inside', '<details>\n<summary>Ejemplo</summary>\n\n```js\nlet a = 1\n```\n\n> [!NOTE]\n> Ojo\n\n</details>'],
  ])('is a toggle, written back as it was: %s', (_name, markdown) => {
    const editor = open(markdown)
    expect(types(editor)).toContain('toggle')
    expect(editor.getMarkdown()).toBe(markdown)
  })

  it('in a list item, stays the same from the second save on', () => {
    const once = open('- uno\n\n  <details>\n  <summary>En lista</summary>\n\n  Texto\n\n  </details>').getMarkdown()
    const twice = open(once)
    expect(types(twice)).toContain('toggle')
    expect(twice.getMarkdown()).toBe(once)
  })

  it.each([
    ['all on one block', '<details><summary>Todo junto</summary>Cuerpo</details>'],
    ['no summary', '<details>\n\nTexto\n\n</details>'],
    ['no end', '<details>\n<summary>Sin cierre</summary>\n\nTexto'],
    ['more after its summary', '<details>\n<summary>A</summary>\n<p>B</p>\n\nTexto\n\n</details>'],
  ])('stays HTML as it was with %s', (_name, markdown) => {
    const editor = open(markdown)
    expect(types(editor)).not.toContain('toggle')
    expect(editor.getMarkdown()).toBe(markdown)
  })
})

describe('a toggle changed in the editor', () => {
  it('writes its summary anew, as text, once its title changes', () => {
    const editor = open('<details>\n  <summary><b>Con etiqueta</b></summary>\n\nTexto\n\n</details>')
    cursorIn(editor, 'toggleTitle')
    editor.commands.insertContent(' & <más>')
    expect(saved(editor)).toBe('<details>\n  <summary>Con etiqueta &amp; &lt;más&gt;</summary>\n\nTexto\n\n</details>')
  })

  it('is shown open or closed without a change to save or undo', () => {
    const markdown = '<details>\n<summary>Más</summary>\n\nDentro\n\n</details>'
    const editor = open(markdown, 'markdown', true)
    const steps = undoDepth(editor.state)
    setToggleOpen(editor, first(editor, 'toggle'), true)
    expect(editor.state.doc.nodeAt(first(editor, 'toggle'))!.attrs.open).toBe(true)
    expect(saved(editor)).toBe(markdown)
    expect(undoDepth(editor.state)).toBe(steps)
  })

  it('is made from a line of text, and turned back into text and what it held', () => {
    const editor = open('Pregunta')
    expect(turns(editor.state.doc, 0).options).toContain('toggle')
    turnBlock(editor, 0, 'toggle')
    expect(saved(editor)).toBe('<details>\n<summary>Pregunta</summary>\n\n</details>')
    cursorIn(editor, 'paragraph')
    editor.commands.insertContent('Respuesta')
    expect(saved(editor)).toBe('<details>\n<summary>Pregunta</summary>\n\nRespuesta\n\n</details>')
    turnBlock(editor, first(editor, 'toggle'), 'p')
    expect(saved(editor)).toBe('Pregunta\n\nRespuesta')
  })

  it('is not offered for text with a picture, which its title couldn\'t hold', () => {
    expect(turns(open('Mira ![x](/api/attachments/x.png)').state.doc, 0).options).not.toContain('toggle')
  })

  it('is put in place of an empty line, with the cursor in its title', () => {
    const editor = open('', 'markdown', true)
    editor.commands.command(({ tr }) => insertToggle(tr))
    expect(editor.state.selection.$from.parent.type.name).toBe('toggleTitle')
    editor.commands.insertContent('Título')
    expect(saved(editor)).toBe('<details>\n<summary>Título</summary>\n\n</details>')
  })

  it('takes Enter in its title into what it holds when open, and to a new line after it when closed', () => {
    const editor = open('<details>\n<summary>Más</summary>\n\nDentro\n\n</details>', 'markdown', true)
    setToggleOpen(editor, first(editor, 'toggle'), true)
    cursorIn(editor, 'toggleTitle')
    press(editor, 'Enter')
    editor.commands.insertContent('Primero')
    expect(saved(editor)).toBe('<details>\n<summary>Más</summary>\n\nPrimero\n\nDentro\n\n</details>')
    setToggleOpen(editor, first(editor, 'toggle'), false)
    cursorIn(editor, 'toggleTitle')
    press(editor, 'Enter')
    editor.commands.insertContent('Después')
    expect(saved(editor)).toBe('<details>\n<summary>Más</summary>\n\nPrimero\n\nDentro\n\n</details>\n\nDespués')
  })

  it('is shown or hidden with Ctrl+Enter in its title, and becomes text with Backspace at its start', () => {
    const editor = open('<details>\n<summary>Más</summary>\n\nDentro\n\n</details>', 'markdown', true)
    cursorIn(editor, 'toggleTitle')
    press(editor, 'Enter', true)
    expect(editor.state.doc.nodeAt(first(editor, 'toggle'))!.attrs.open).toBe(true)
    cursorIn(editor, 'toggleTitle', 'start')
    press(editor, 'Backspace')
    expect(saved(editor)).toBe('Más\n\nDentro')
  })
})

describe('a toggle as HTML', () => {
  it('comes back the same through copy and paste', () => {
    const markdown = '<details open>\n  <summary><b>Con etiqueta</b></summary>\n\nTexto\n\n</details>'
    expect(open(open(markdown).getHTML(), 'html').getMarkdown()).toBe(markdown)
  })

  it('is read from a <details> copied from a web page', () => {
    expect(open('<details><summary>Pregunta</summary><p>Respuesta</p></details>', 'html').getMarkdown()).toBe('<details>\n<summary>Pregunta</summary>\n\nRespuesta\n\n</details>')
  })

  it('is the browser\'s own <details> in a comment, its summary only text', () => {
    const html = markdownToHtml('<details>\n<summary><img src=x onerror=alert(1)>Más</summary>\n\nDentro\n\n</details>')
    expect(html).toMatch(/^<details [^>]*class="orq-toggle"><summary class="orq-toggle-title">Más<\/summary><p>Dentro<\/p><\/details>$/)
    expect(html).not.toContain('<img')
  })
})
