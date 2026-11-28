// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { undoDepth } from '@tiptap/pm/history'
import { Slice } from '@tiptap/pm/model'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import i18next from 'i18next'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import docs from '../src/i18n/locales/es/docs.json'
import { turnBlock, turns } from '../src/features/docs/editor/block-commands'
import { documentExtensions } from '../src/features/docs/editor/markdown'
import { markdownToHtml } from '../src/features/docs/editor/markdown-html'
import { insertToggle, levelOf, outOfTitle, setToggleOpen, showTogglesAsBefore, togglesShown } from '../src/features/docs/editor/toggle'

// HTML's <details> as a toggle in the editor: a title that shows or hides what is under it, written
// back as the HTML and Markdown it was.
const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))
// The placeholder of an empty title, in the app's language.
beforeAll(() => i18next.init({ lng: 'es', resources: { es: { docs } }, ns: ['docs'] }))

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
/** The cursor at the start or the end of the paragraph whose text is `text`. */
const cursorAt = (editor: Editor, text: string, at: 'start' | 'end' = 'start') => {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === 'paragraph' && node.textContent === text) found = at === 'start' ? pos + 1 : pos + node.nodeSize - 1
    return found === -1
  })
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, found)))
}
/** Text typed key by key, as the browser sends it: what the editor makes of it as it is typed (its input rules) included. */
const type = (editor: Editor, text: string) => {
  for (const char of text) {
    const { from, to } = editor.state.selection
    if (!editor.view.someProp('handleTextInput', (handle) => handle(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)))) editor.view.dispatch(editor.state.tr.insertText(char, from, to))
  }
}
const titleText = (editor: Editor) => editor.state.doc.nodeAt(first(editor, 'toggleTitle'))!.textContent

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
    ['as GitHub\'s guide writes it, a blank line before its summary', '<details>\n\n<summary>Consejos</summary>\n\n### Un título\n\nTexto\n\n</details>'],
    ['with its summary over several lines', '<details>\n<summary>\n    <b>En varias líneas</b>\n  </summary>\n\nTexto\n\n</details>'],
    ['with only blank lines', '<details>\n<summary>Hueco</summary>\n\n\n\n</details>'],
  ])('is a toggle, written back as it was: %s', (_name, markdown) => {
    const editor = open(markdown)
    expect(types(editor)).toContain('toggle')
    expect(editor.getMarkdown()).toBe(markdown)
  })

  it.each([
    ['in a quote', '> <details>\n>\n> <summary>En cita</summary>\n>\n> Texto\n>\n> </details>'],
    ['in a callout', '> [!NOTE]\n> <details>\n>\n> <summary>En aviso</summary>\n>\n> Texto\n>\n> </details>'],
  ])('as GitHub\'s guide writes it, is one %s too', (_name, markdown) => {
    const editor = open(markdown)
    expect(types(editor)).toContain('toggle')
    expect(editor.getMarkdown()).toBe(markdown)
  })

  it('as GitHub\'s guide writes it, in a list item, stays the same from the second save on', () => {
    const once = open('- uno\n\n  <details>\n\n  <summary>En lista</summary>\n\n  Texto\n\n  </details>').getMarkdown()
    const twice = open(once)
    expect(types(twice)).toContain('toggle')
    expect(twice.getMarkdown()).toBe(once)
  })

  it('shows its summary as one line of text', () => {
    expect(titleText(open('<details>\n<summary>\n    <b>En varias líneas</b>\n  </summary>\n\nTexto\n\n</details>'))).toBe('En varias líneas')
    expect(titleText(open('<details>\n\n<summary>Consejos</summary>\n\nTexto\n\n</details>'))).toBe('Consejos')
  })

  it('writes what it holds as the same blocks would be written outside it, empty lines included', () => {
    for (const body of ['A\n\n\n\n&nbsp;\n\nB', 'A\n\n&nbsp;\n\n&nbsp;\n\nB', 'A\n\n\n\nB']) {
      const wrap = (inside: string) => `<details>\n<summary>S</summary>\n\n${inside}\n\n</details>`
      expect(open(wrap(body)).getMarkdown()).toBe(wrap(open(body).getMarkdown()))
    }
  })

  it('is closed unless its own `open` says otherwise, not a word in another attribute', () => {
    const editor = open('<details title="please open it">\n<summary>A</summary>\n\nB\n\n</details>')
    expect(editor.state.doc.nodeAt(first(editor, 'toggle'))!.attrs.open).toBe(false)
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
    ['its end at the end of other HTML', '<details>\n<summary>Captura</summary>\n\nMira:\n\n<img src="/x.png">\n</details>\n\nDespués\n\n</details>'],
    ['the next one\'s start right after its end', '<details>\n<summary>A</summary>\n\nUno\n\n</details>\n<details>\n<summary>B</summary>\n\nDos\n\n</details>'],
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

  it('is not offered for text with a picture, a link or formatting, which its title couldn\'t hold', () => {
    for (const text of ['Mira ![x](/api/attachments/x.png)', 'Ver [el contrato](/card/x)', 'Esto **ya**']) expect(turns(open(text).state.doc, 0).options).not.toContain('toggle')
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

  it('says what its empty title is for', () => {
    const editor = open('', 'markdown', true)
    editor.commands.command(({ tr }) => insertToggle(tr))
    const title = editor.view.dom.querySelector('.orq-toggle-title')!
    expect(title.classList.contains('is-empty')).toBe(true)
    expect(title.getAttribute('data-placeholder')).toBe('Título del desplegable')
  })

  it('takes what is typed in its title as text, never as Markdown, and Shift+Enter as Enter', () => {
    const editor = open('', 'markdown', true)
    editor.commands.command(({ tr }) => insertToggle(tr))
    type(editor, '--- **a** ')
    expect(titleText(editor)).toBe('--- **a** ')
    expect(saved(editor)).toBe('<details>\n<summary>--- **a**</summary>\n\n</details>')
    press(editor, 'Enter')
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
    cursorIn(editor, 'toggleTitle')
    editor.view.someProp('handleKeyDown', (handle) => handle(editor.view, new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true })))
    expect(titleText(editor)).toBe('--- **a** ')
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
  })

  it('takes what is pasted into its title as one line of text', () => {
    const editor = open('<details>\n<summary>Más</summary>\n\nDentro\n\n</details>', 'markdown', true)
    cursorIn(editor, 'toggleTitle')
    const event = { clipboardData: { getData: () => 'uno\n\ndos' } } as unknown as ClipboardEvent
    editor.view.someProp('handlePaste', (handle) => handle(editor.view, event, Slice.empty))
    expect(saved(editor)).toBe('<details>\n<summary>Másuno dos</summary>\n\nDentro\n\n</details>')
  })

  it('is put only where a toggle can go: not in its own title nor in a table\'s cell, and after an empty item', () => {
    const editor = open('<details>\n<summary></summary>\n\nDentro\n\n</details>\n\n| a |\n| --- |\n| b |', 'markdown', true)
    cursorIn(editor, 'toggleTitle')
    expect(insertToggle(editor.state.tr)).toBe(false)
    cursorIn(editor, 'tableCell')
    expect(insertToggle(editor.state.tr)).toBe(false)
    const list = open('', 'markdown', true)
    list.commands.setContent({ type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }] })
    cursorIn(list, 'paragraph')
    list.commands.command(({ tr }) => insertToggle(tr))
    expect(list.state.selection.$from.parent.type.name).toBe('toggleTitle')
    // In the item, after its empty line; the editor's empty line after a list at the end, as ever.
    expect(types(list)).toEqual(['bulletList', 'listItem', 'paragraph', 'toggle', 'toggleTitle', 'paragraph', 'paragraph'])
  })

  it('is selected by Backspace right after it when closed, and takes the line\'s text into its last one when open', () => {
    const markdown = '<details>\n<summary>Más</summary>\n\nOculto\n\n</details>\n\nDespués'
    const closed = open(markdown, 'markdown', true)
    cursorAt(closed, 'Después')
    press(closed, 'Backspace')
    expect(closed.state.selection).toBeInstanceOf(NodeSelection)
    expect(saved(closed)).toBe(markdown)
    const opened = open(markdown, 'markdown', true)
    setToggleOpen(opened, first(opened, 'toggle'), true)
    cursorAt(opened, 'Después')
    press(opened, 'Backspace')
    expect(saved(opened)).toBe('<details>\n<summary>Más</summary>\n\nOcultoDespués\n\n</details>')
  })

  it('takes the first line it holds into its title only if it is plain text', () => {
    const plain = open('<details open>\n<summary>Más</summary>\n\nDentro\n\nOtro\n\n</details>', 'markdown', true)
    cursorAt(plain, 'Dentro')
    press(plain, 'Backspace')
    expect(saved(plain)).toBe('<details open>\n<summary>MásDentro</summary>\n\nOtro\n\n</details>')
    const bold = '<details open>\n<summary>Más</summary>\n\n**Dentro**\n\n</details>'
    const formatted = open(bold, 'markdown', true)
    cursorAt(formatted, 'Dentro')
    press(formatted, 'Backspace')
    expect(saved(formatted)).toBe(bold)
    expect(formatted.state.selection.$from.parent.type.name).toBe('toggleTitle')
    // Delete at the end of the title of a closed one brings nothing hidden up into it.
    const closed = '<details>\n<summary>Más</summary>\n\nDentro\n\n</details>'
    const hidden = open(closed, 'markdown', true)
    cursorIn(hidden, 'toggleTitle')
    press(hidden, 'Delete')
    expect(saved(hidden)).toBe(closed)
  })

  it('becomes text with Backspace, its list joined with the one after it', () => {
    const editor = open('<details>\n<summary>Lista</summary>\n\n- a\n\n</details>\n\n- b', 'markdown', true)
    cursorIn(editor, 'toggleTitle', 'start')
    press(editor, 'Backspace')
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(['paragraph', 'bulletList', 'paragraph'])
    expect(saved(editor)).toBe('Lista\n\n- a\n- b')
  })

  it('keeps the cursor out of what it hides, a selection that ends there too', () => {
    const editor = open('<details open>\n<summary>Más</summary>\n\nDentro\n\n</details>', 'markdown', true)
    const title = first(editor, 'toggleTitle')
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, title + 1, title + 8)))
    setToggleOpen(editor, first(editor, 'toggle'), false)
    expect(editor.state.selection.$to.parent.type.name).toBe('toggleTitle')
    expect(editor.view.dom.querySelector('.orq-toggle--reveal')).toBeNull()
  })

  it('stays open or closed as the reader left it when the page is read again', () => {
    const markdown = '<details>\n<summary>Uno</summary>\n\nA\n\n</details>\n\n<details open>\n<summary>Dos</summary>\n\nB\n\n</details>\n\n<details>\n<summary>Tres</summary>\n\nC\n\n</details>'
    const editor = open(markdown, 'markdown', true)
    const toggles = () => { const found: boolean[] = []; editor.state.doc.descendants((node) => void (node.type.name === 'toggle' && found.push(node.attrs.open))); return found }
    let second = -1
    editor.state.doc.descendants((node, pos) => void (node.type.name === 'toggle' && node.textContent.startsWith('Dos') && (second = pos)))
    setToggleOpen(editor, first(editor, 'toggle'), true)
    setToggleOpen(editor, second, false)
    const shown = togglesShown(editor.state.doc)
    editor.commands.setContent(`Nuevo\n\n${markdown}`, { contentType: 'markdown', emitUpdate: false })
    showTogglesAsBefore(editor, shown)
    expect(toggles()).toEqual([true, false, false])
    expect(saved(editor)).toBe(`Nuevo\n\n${markdown}`)
  })

  it('is selected by Backspace at the start of a quote or a callout right after it when closed', () => {
    for (const after of ['> Cita', '> [!NOTE]\n> Cita']) {
      const markdown = `<details>\n<summary>Más</summary>\n\nOculto\n\n</details>\n\n${after}`
      const editor = open(markdown, 'markdown', true)
      cursorAt(editor, 'Cita')
      press(editor, 'Backspace')
      expect(editor.state.selection).toBeInstanceOf(NodeSelection)
      expect(saved(editor)).toBe(markdown)
    }
  })

  it('takes away with Backspace an empty line right after it when closed, the cursor to its title', () => {
    const markdown = '<details>\n<summary>Más</summary>\n\nOculto\n\n</details>\n\nFin'
    const editor = open(markdown, 'markdown', true)
    cursorIn(editor, 'toggleTitle')
    press(editor, 'Enter')
    expect(saved(editor)).toBe('<details>\n<summary>Más</summary>\n\nOculto\n\n</details>\n\n\n\nFin')
    press(editor, 'Backspace')
    expect(saved(editor)).toBe(markdown)
    expect(editor.state.selection.$from.parent.type.name).toBe('toggleTitle')
  })

  it('leaves a block of code right after it a block of code with Backspace, when open', () => {
    const editor = open('<details open>\n<summary>Más</summary>\n\nÚltimo\n\n</details>\n\n```js\nlet a = 1\nlet b = 2\n```', 'markdown', true)
    let code = -1
    editor.state.doc.descendants((node, pos) => void (node.type.name === 'codeBlock' && (code = pos)))
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, code + 1)))
    press(editor, 'Backspace')
    expect(saved(editor)).toContain('```js\nlet a = 1\nlet b = 2\n```')
  })

  it('takes its only line into its title with Backspace at its start, or Delete at the end of its title', () => {
    const back = open('<details open>\n<summary>Más</summary>\n\nDentro\n\n</details>', 'markdown', true)
    cursorAt(back, 'Dentro')
    press(back, 'Backspace')
    expect(saved(back)).toBe('<details open>\n<summary>MásDentro</summary>\n\n</details>')
    expect(back.state.selection.$from.parent.type.name).toBe('toggleTitle')
    const forward = open('<details open>\n<summary>Más</summary>\n\nDentro\n\n</details>', 'markdown', true)
    cursorIn(forward, 'toggleTitle')
    press(forward, 'Delete')
    expect(saved(forward)).toBe('<details open>\n<summary>MásDentro</summary>\n\n</details>')
  })

  it('selects a block of HTML or a rule it starts with for Delete at the end of its title, rather than deleting it', () => {
    for (const first of ['<div>importante</div>', '---']) {
      const markdown = `<details open>\n<summary>Más</summary>\n\n${first}\n\nDespués\n\n</details>`
      const editor = open(markdown, 'markdown', true)
      cursorIn(editor, 'toggleTitle')
      press(editor, 'Delete')
      expect(saved(editor)).toBe(markdown)
      expect(editor.state.selection).toBeInstanceOf(NodeSelection)
    }
  })

  it('reuses the empty line after it for Enter in its title when closed', () => {
    const editor = open('<details>\n<summary>Más</summary>\n\nOculto\n\n</details>', 'markdown', true)
    // The empty line the editor keeps after it at the end, not one more each time.
    for (let i = 0; i < 2; i++) {
      cursorIn(editor, 'toggleTitle')
      press(editor, 'Enter')
      expect(editor.state.doc.childCount).toBe(2)
      expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
    }
  })

  it('keeps a non-breaking space typed in its title as `&nbsp;`, and pasted text\'s spaces around it', () => {
    const editor = open('<details>\n<summary>Más</summary>\n\nDentro\n\n</details>', 'markdown', true)
    cursorIn(editor, 'toggleTitle')
    const event = { clipboardData: { getData: () => ' y\u00a0más ' } } as unknown as ClipboardEvent
    editor.view.someProp('handlePaste', (handle) => handle(editor.view, event, Slice.empty))
    expect(saved(editor)).toBe('<details>\n<summary>Más y&nbsp;más</summary>\n\nDentro\n\n</details>')
    expect(open(saved(editor)).getMarkdown()).toBe(saved(editor))
  })

  it('sends a file put in its title under the title, or after itself when closed', () => {
    const editor = open('<details open>\n<summary>Abierto</summary>\n\nA\n\n</details>\n\n<details>\n<summary>Cerrado</summary>\n\nB\n\n</details>')
    const titles: number[] = []
    editor.state.doc.descendants((node, pos) => void (node.type.name === 'toggleTitle' && titles.push(pos)))
    const [openTitle, closedTitle] = titles as [number, number]
    expect(editor.state.doc.resolve(outOfTitle(editor.state.doc, openTitle + 2)).nodeAfter?.textContent).toBe('A')
    expect(outOfTitle(editor.state.doc, closedTitle + 2)).toBe(closedTitle - 1 + editor.state.doc.nodeAt(closedTitle - 1)!.nodeSize)
    // Right before a title, as a drop beside its arrow can be read: as in the title.
    expect(outOfTitle(editor.state.doc, openTitle)).toBe(outOfTitle(editor.state.doc, openTitle + 2))
    // In what an open one holds, where it was; in what a closed one hides, after it.
    let a = -1
    editor.state.doc.descendants((node, pos) => void (node.type.name === 'paragraph' && node.textContent === 'A' && (a = pos + 1)))
    expect(outOfTitle(editor.state.doc, a)).toBe(a)
    expect(outOfTitle(editor.state.doc, closedTitle + editor.state.doc.nodeAt(closedTitle)!.nodeSize + 1)).toBe(outOfTitle(editor.state.doc, closedTitle + 2))
  })

  it('keeps its rules for Backspace and Delete with Ctrl (or ⌘) and Shift too', () => {
    const formatted = '<details open>\n<summary>Más</summary>\n\nMira ![x](/a.png) y [enlace](/x)\n\n</details>'
    const back = open(formatted, 'markdown', true)
    cursorAt(back, 'Mira  y enlace')
    back.view.someProp('handleKeyDown', (handle) => handle(back.view, new KeyboardEvent('keydown', { key: 'Backspace', ctrlKey: true })))
    expect(saved(back)).toBe(formatted)
    const closed = '<details>\n<summary>Más</summary>\n\nOculto\n\n</details>\n\nDespués'
    const shift = open(closed, 'markdown', true)
    cursorAt(shift, 'Después')
    shift.view.someProp('handleKeyDown', (handle) => handle(shift.view, new KeyboardEvent('keydown', { key: 'Backspace', shiftKey: true })))
    expect(shift.state.selection).toBeInstanceOf(NodeSelection)
    expect(saved(shift)).toBe(closed)
    const forward = open(closed, 'markdown', true)
    cursorIn(forward, 'toggleTitle')
    forward.view.someProp('handleKeyDown', (handle) => handle(forward.view, new KeyboardEvent('keydown', { key: 'Delete', ctrlKey: true })))
    expect(saved(forward)).toBe(closed)
  })

  it('at the end of a task item, leaves its task list one list', () => {
    const once = open('- [ ] uno\n\n  <details>\n  <summary>A</summary>\n\n  Texto\n\n  </details>\n- [x] dos\n- [ ] tres').getMarkdown()
    const again = open(once)
    expect(again.getJSON().content?.map((node) => node.type)).toEqual(['taskList'])
    expect(again.getMarkdown()).toBe(once)
  })

  it('empty in a list item, with a line after it, stays a toggle and the line stays as it is', () => {
    const once = open('- uno\n\n  <details>\n  <summary>A</summary>\n\n  </details>\n\n  con snake_case y **b**').getMarkdown()
    const again = open(once)
    expect(() => again.state.doc.check()).not.toThrow()
    expect(types(again)).toContain('toggle')
    expect(again.getMarkdown()).toBe(once)
    expect(once).toContain('con snake\\_case y **b**')
  })

  it('in a list item, keeps the block after it apart, so that it is still a toggle when the page is read again', () => {
    for (const after of ['> Cita', '```js\n  x\n  ```', '<details>\n  <summary>Otro</summary>\n\n  Dos\n\n  </details>']) {
      const once = open(`- uno\n\n  <details>\n  <summary>En lista</summary>\n\n  Texto\n\n  </details>\n\n  ${after}`).getMarkdown()
      const twice = open(once)
      expect(types(twice).filter((name) => name === 'toggle').length).toBe(after.startsWith('<details') ? 2 : 1)
      expect(twice.getMarkdown()).toBe(once)
    }
  })

  it('leaves the page\'s last empty line and an empty block of code after it when closed, with Backspace, to the editor', () => {
    const markdown = '<details>\n<summary>Más</summary>\n\nOculto\n\n</details>'
    const editor = open(markdown, 'markdown', true)
    // The editor puts its empty line after it with the first change, this one.
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, editor.state.doc.content.size - 1)))
    const steps = undoDepth(editor.state)
    press(editor, 'Backspace')
    expect(editor.state.selection.$from.parent.type.name).toBe('toggleTitle')
    expect(undoDepth(editor.state)).toBe(steps)
    const code = open(`${markdown}\n\n\`\`\`js\n\`\`\`\n\nFin`, 'markdown', true)
    let at = -1
    code.state.doc.descendants((node, pos) => void (node.type.name === 'codeBlock' && (at = pos + 1)))
    code.view.dispatch(code.state.tr.setSelection(TextSelection.create(code.state.doc, at)))
    press(code, 'Backspace')
    // Its own Backspace: a line, as everywhere else.
    expect(code.state.selection.$from.parent.type.name).toBe('paragraph')
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

describe('a toggle whose title is a heading', () => {
  const github = '<details>\n<summary><h2>Más</h2></summary>\n\nDentro\n\n</details>'

  it('is read as GitHub writes it, shown as that heading, and written back the same', () => {
    const editor = open(github, 'markdown', true)
    expect(saved(editor)).toBe(github)
    expect(editor.state.doc.nodeAt(first(editor, 'toggleTitle'))!.textContent).toBe('Más')
    expect(editor.view.dom.querySelector('.orq-toggle')!.getAttribute('data-level')).toBe('2')
    const title = editor.view.dom.querySelector('.orq-toggle-title')!
    expect([title.getAttribute('role'), title.getAttribute('aria-level')]).toEqual(['heading', '2'])
  })

  it('keeps its heading, with its attributes, once its title changes', () => {
    const editor = open('<details>\n<summary><h3 id="faq">Más</h3></summary>\n\nDentro\n\n</details>')
    cursorIn(editor, 'toggleTitle')
    editor.commands.insertContent(' & <datos>')
    expect(saved(editor)).toBe('<details>\n<summary><h3 id="faq">Más &amp; &lt;datos&gt;</h3></summary>\n\nDentro\n\n</details>')
  })

  it('is one heading alone: two, or text around one, are a title of text', () => {
    expect(levelOf('<h2>Más</h2>')).toBe(2)
    expect(levelOf(' <H6 class="x">Más</H6>\n')).toBe(6)
    for (const other of ['<h2>Uno</h2> <h3>Dos</h3>', 'Ver <h2>Más</h2>', '<h2>Más', '<h7>Más</h7>', '<b>Más</b>', '']) expect(levelOf(other), other).toBe(0)
    const editor = open('<details>\n<summary><h2>Uno</h2> <h3>Dos</h3></summary>\n\nDentro\n\n</details>')
    cursorIn(editor, 'toggleTitle')
    editor.commands.insertContent('!')
    expect(saved(editor)).toBe('<details>\n<summary>Uno Dos!</summary>\n\nDentro\n\n</details>')
  })

  it('is put in place of an empty line from the «/» menu, at levels 1 to 3', () => {
    for (const level of [1, 2, 3]) {
      const editor = open('', 'markdown', true)
      editor.commands.command(({ tr }) => insertToggle(tr, level))
      editor.commands.insertContent('Título')
      expect(saved(editor)).toBe(`<details>\n<summary><h${level}>Título</h${level}></summary>\n\n</details>`)
    }
  })

  it('is made from a line of text or a heading, turned into another level or a toggle, and back into text', () => {
    const editor = open('Pregunta\n\n### Sección')
    expect(turns(editor.state.doc, 0).options).toEqual(expect.arrayContaining(['toggle', 'toggleH1', 'toggleH2', 'toggleH3']))
    turnBlock(editor, 0, 'toggleH2')
    expect(saved(editor)).toBe('<details>\n<summary><h2>Pregunta</h2></summary>\n\n</details>\n\n### Sección')
    cursorIn(editor, 'paragraph')
    editor.commands.insertContent('Respuesta')
    const toggle = first(editor, 'toggle')
    expect(turns(editor.state.doc, toggle)).toEqual({ current: 'toggleH2', options: ['p', 'toggle', 'toggleH1', 'toggleH2', 'toggleH3'] })
    turnBlock(editor, toggle, 'toggleH1')
    expect(saved(editor)).toBe('<details>\n<summary><h1>Pregunta</h1></summary>\n\nRespuesta\n\n</details>\n\n### Sección')
    turnBlock(editor, toggle, 'toggle')
    expect(saved(editor)).toBe('<details>\n<summary>Pregunta</summary>\n\nRespuesta\n\n</details>\n\n### Sección')
    turnBlock(editor, toggle, 'p')
    expect(saved(editor)).toBe('Pregunta\n\nRespuesta\n\n### Sección')
    // A heading keeps its text as the title.
    const heading = first(editor, 'heading')
    turnBlock(editor, heading, 'toggleH3')
    expect(saved(editor)).toBe('Pregunta\n\nRespuesta\n\n<details>\n<summary><h3>Sección</h3></summary>\n\n</details>')
  })

  it('of level 4 to 6, written elsewhere, is none of the menu\'s but can be turned into one', () => {
    const editor = open('<details>\n<summary><h5>Nota</h5></summary>\n\nDentro\n\n</details>')
    expect(turns(editor.state.doc, 0).current).toBeNull()
    turnBlock(editor, 0, 'toggleH3')
    expect(saved(editor)).toBe('<details>\n<summary><h3>Nota</h3></summary>\n\nDentro\n\n</details>')
  })

  it('is the browser\'s own <details> in a comment, with its heading in its summary', () => {
    expect(markdownToHtml(github)).toMatch(/^<details [^>]*class="orq-toggle" data-level="2"><summary class="orq-toggle-title"><h2>Más<\/h2><\/summary><p>Dentro<\/p><\/details>$/)
  })

  it('is read from a <details> copied from GitHub, its heading as its title', () => {
    expect(open('<details><summary><h2>Más</h2></summary><p>Dentro</p></details>', 'html').getMarkdown()).toBe(github)
    // As GitHub shows a heading: wrapped, with a link to it that has no text.
    const shown = '<details><summary><div class="markdown-heading"><h2 class="heading-element">Más</h2><a id="user-content-más" class="anchor" href="#más"><svg></svg></a></div></summary><p>Dentro</p></details>'
    expect(open(shown, 'html').getMarkdown()).toBe(github)
    expect(open(open(github).getHTML(), 'html').getMarkdown()).toBe(github)
  })

  it('is no heading pasted with text around its heading, and its text keeps its spaces', () => {
    expect(open('<details><summary>Nota: <h2>Más</h2></summary><p>Dentro</p></details>', 'html').getMarkdown()).toBe('<details>\n<summary>Nota: Más</summary>\n\nDentro\n\n</details>')
    expect(open('<details><summary>Línea<br>dos <b>y</b> <i>tres</i></summary><p>Dentro</p></details>', 'html').getMarkdown()).toBe('<details>\n<summary>Línea dos y tres</summary>\n\nDentro\n\n</details>')
    expect(open('<details><summary><h2>A</h2><p>B</p></summary><p>Dentro</p></details>', 'html').getMarkdown()).toBe('<details>\n<summary>A B</summary>\n\nDentro\n\n</details>')
  })

  it('copied in part with its title and pasted, keeps the spaces of the title', () => {
    const editor = open('<details>\n<summary>Hola mundo</summary>\n\nCuerpo\n\n</details>\n\nPara', 'markdown', true)
    setToggleOpen(editor, 0, true)
    const title = first(editor, 'toggleTitle')
    const body = first(editor, 'paragraph')
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, title + 1 + 'Hola'.length, body + 1 + 'Cuerpo'.length)))
    const { dom } = editor.view.serializeForClipboard(editor.state.selection.content())
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)))
    // jsdom has no ClipboardEvent, which ProseMirror makes for a paste.
    globalThis.ClipboardEvent ??= class extends Event {
      clipboardData = null
    } as unknown as typeof ClipboardEvent
    editor.view.pasteHTML(dom.innerHTML)
    expect(saved(editor)).toMatch(/\n\nPara mundo/)
  })

  it('keeps its heading\'s attributes and what its title holds when its level changes, with `>` in an attribute too', () => {
    const editor = open('<details>\n<summary><h2 id="faq" title="a>b"><a href="/x">Enlace</a> &amp; <code>c</code></h2></summary>\n\nDentro\n\n</details>', 'markdown', true)
    expect(levelOf(String(editor.state.doc.firstChild!.attrs.summary))).toBe(2)
    turnBlock(editor, 0, 'toggleH1')
    expect(saved(editor)).toBe('<details>\n<summary><h1 id="faq" title="a>b"><a href="/x">Enlace</a> &amp; <code>c</code></h1></summary>\n\nDentro\n\n</details>')
    expect(editor.view.dom.querySelector('.orq-toggle')!.getAttribute('data-level')).toBe('1')
    expect(editor.view.dom.querySelector('.orq-toggle-title')!.getAttribute('aria-level')).toBe('1')
    turnBlock(editor, 0, 'toggle')
    expect(saved(editor)).toBe('<details>\n<summary><a href="/x">Enlace</a> &amp; <code>c</code></summary>\n\nDentro\n\n</details>')
    expect(editor.view.dom.querySelector('.orq-toggle')!.hasAttribute('data-level')).toBe(false)
    expect(editor.view.dom.querySelector('.orq-toggle-title')!.hasAttribute('role')).toBe(false)
    turnBlock(editor, 0, 'toggleH3')
    expect(saved(editor)).toBe('<details>\n<summary><h3><a href="/x">Enlace</a> &amp; <code>c</code></h3></summary>\n\nDentro\n\n</details>')
    // Its title changed first, it is written anew as text.
    cursorIn(editor, 'toggleTitle')
    editor.commands.insertContent('!')
    turnBlock(editor, 0, 'toggleH2')
    expect(saved(editor)).toBe('<details>\n<summary><h2>Enlace &amp; c!</h2></summary>\n\nDentro\n\n</details>')
  })

  it('keeps an attribute with `>` in it closed when its title changes', () => {
    const editor = open('<details>\n<summary><h2 title="a>b">Más</h2></summary>\n\nDentro\n\n</details>')
    cursorIn(editor, 'toggleTitle')
    editor.commands.insertContent('!')
    expect(saved(editor)).toBe('<details>\n<summary><h2 title="a>b">Más!</h2></summary>\n\nDentro\n\n</details>')
    expect(markdownToHtml(saved(editor))).toContain('<h2>Más!</h2>')
  })
})

describe('a toggle as HTML', () => {
  it('comes back the same through copy and paste', () => {
    const markdown = '<details open>\n  <summary><b>Con etiqueta</b></summary>\n\nTexto\n\n</details>'
    expect(open(open(markdown).getHTML(), 'html').getMarkdown()).toBe(markdown)
  })

  it('writes only what a <details> can be written as, whatever a pasted one says', () => {
    const expected = '<details>\n<summary>Pregunta</summary>\n\nRespuesta\n\n</details>'
    const html = '<details data-head="&lt;div&gt;" data-closing="" data-tail="x" data-summary="&lt;/summary&gt;"><summary>Pregunta</summary><p>Respuesta</p></details>'
    expect(open(html, 'html').getMarkdown()).toBe(expected)
    // A blank line inside its tag would end its HTML block there, on GitHub.
    const blank = '<details data-head="&lt;details&#10;&#10;&lt;script&gt;&lt;summary&gt;"><summary>Pregunta</summary><p>Respuesta</p></details>'
    expect(open(blank, 'html').getMarkdown()).toBe(expected)
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
