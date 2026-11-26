// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import { blockAt, canMove, deleteBlock, duplicateBlock, moveBlock, turnBlock, turns } from '../src/features/docs/editor/block-commands'
import { BlockKeys } from '../src/features/docs/editor/extensions'
import { documentExtensions } from '../src/features/docs/editor/markdown'

// Each action of the block handle changes the Markdown the way it says, and what it makes reads back the same.
const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))

function open(markdown: string) {
  const editor = new Editor({ extensions: documentExtensions(), content: markdown, contentType: 'markdown' })
  editors.push(editor)
  return editor
}

/** The block whose text starts with `text`, as the handle finds it under the pointer. */
function block(editor: Editor, text: string) {
  let at = -1
  editor.state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text?.startsWith(text)) at = pos
    return at === -1
  })
  const found = blockAt(editor.state.doc, at)
  if (!found) throw new Error(`no block at ${text}`)
  return found.pos
}

/** Saved and read again, the Markdown is the same. */
function saved(editor: Editor) {
  const markdown = editor.getMarkdown()
  expect(open(markdown).getMarkdown()).toBe(markdown)
  return markdown.trim()
}

describe('block handle', () => {
  it('finds the list item, or else the block of the top level', () => {
    const editor = open('# Título\n\n- uno\n  - dentro\n- dos\n\n> cita\n\n| a |\n| --- |\n| b |')
    expect(editor.state.doc.nodeAt(block(editor, 'Título'))?.type.name).toBe('heading')
    expect(editor.state.doc.nodeAt(block(editor, 'dentro'))?.textContent).toBe('dentro')
    expect(editor.state.doc.nodeAt(block(editor, 'uno'))?.type.name).toBe('listItem')
    expect(editor.state.doc.nodeAt(block(editor, 'cita'))?.type.name).toBe('blockquote')
    expect(editor.state.doc.nodeAt(block(editor, 'b'))?.type.name).toBe('table')
  })

  it('moves blocks up and down, the cursor with them', () => {
    const editor = open('Uno\n\nDos\n\nTres')
    const pos = block(editor, 'Tres')
    editor.commands.setTextSelection(pos + 3)
    expect(moveBlock(editor, pos, -1)).toBe(true)
    expect(saved(editor)).toBe('Uno\n\nTres\n\nDos')
    editor.commands.insertContent('!')
    expect(saved(editor)).toBe('Uno\n\nTr!es\n\nDos')
    expect(moveBlock(editor, block(editor, 'Uno'), -1)).toBe(false)
    expect(moveBlock(editor, block(editor, 'Uno'), 1)).toBe(true)
    expect(saved(editor)).toBe('Tr!es\n\nUno\n\nDos')
  })

  it('moves list items within their list, and keeps the numbering right', () => {
    const editor = open('1. uno\n2. dos\n3. tres')
    moveBlock(editor, block(editor, 'tres'), -1)
    expect(saved(editor)).toBe('1. uno\n2. tres\n3. dos')
    expect(canMove(editor.state.doc, block(editor, 'uno'), -1)).toBe(false)
    expect(canMove(editor.state.doc, block(editor, 'dos'), 1)).toBe(false)
  })

  it('never moves a block above the front matter, nor the front matter itself', () => {
    const editor = open('---\ntitle: Hola\n---\n\nTexto\n\nMás')
    expect(canMove(editor.state.doc, block(editor, 'Texto'), -1)).toBe(false)
    expect(blockAt(editor.state.doc, 0)).toBe(null)
    moveBlock(editor, block(editor, 'Más'), -1)
    expect(saved(editor)).toBe('---\ntitle: Hola\n---\n\nMás\n\nTexto')
  })

  it('duplicates a block right below it, a table too', () => {
    const editor = open('Antes\n\n| a | b |\n| --- | --- |\n| 1 | 2 |')
    duplicateBlock(editor, block(editor, 'Antes'))
    duplicateBlock(editor, block(editor, '1'))
    const markdown = saved(editor)
    expect(markdown.match(/^Antes$/gm)).toHaveLength(2)
    expect(markdown.match(/^\| a +\| b +\|$/gm)).toHaveLength(2)
  })

  it('deletes a block, and the list with its last item', () => {
    const editor = open('Uno\n\n- solo\n\nDos')
    deleteBlock(editor, block(editor, 'Uno'))
    expect(saved(editor)).toBe('- solo\n\nDos')
    deleteBlock(editor, block(editor, 'solo'))
    expect(saved(editor)).toBe('Dos')
    deleteBlock(editor, block(editor, 'Dos'))
    expect(editor.getMarkdown().trim()).toBe('')
    expect(editor.state.doc.childCount).toBe(1)
  })

  it('turns a block into what the «/» menu offers', () => {
    const editor = open('Hola\n\nAdiós')
    expect(turns(editor.state.doc, block(editor, 'Hola'))).toEqual({ current: 'p', options: ['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'todo', 'quote', 'callout', 'toggle', 'code'] })
    turnBlock(editor, block(editor, 'Hola'), 'h2')
    expect(saved(editor)).toBe('## Hola\n\nAdiós')
    turnBlock(editor, block(editor, 'Hola'), 'todo')
    expect(saved(editor)).toBe('- [ ] Hola\n\nAdiós')
    // A list item: back to text, out of the list.
    turnBlock(editor, block(editor, 'Hola'), 'p')
    expect(saved(editor)).toBe('Hola\n\nAdiós')
    turnBlock(editor, block(editor, 'Adiós'), 'quote')
    expect(saved(editor)).toBe('Hola\n\n> Adiós')
    expect(turns(editor.state.doc, block(editor, 'Adiós')).current).toBe('quote')
    turnBlock(editor, block(editor, 'Adiós'), 'p')
    turnBlock(editor, block(editor, 'Adiós'), 'code')
    expect(saved(editor)).toBe('Hola\n\n```\nAdiós\n```')
  })

  it('changes the kind of a whole list from one of its items', () => {
    const editor = open('- uno\n- dos')
    expect(turns(editor.state.doc, block(editor, 'dos'))).toEqual({ current: 'ul', options: ['p', 'ul', 'ol', 'todo'] })
    turnBlock(editor, block(editor, 'dos'), 'ol')
    expect(saved(editor)).toBe('1. uno\n2. dos')
  })

  it('offers nothing to turn a table, a rule or HTML into', () => {
    const editor = open('| a |\n| --- |\n| b |\n\n---\n\n<div>x</div>')
    expect(turns(editor.state.doc, block(editor, 'b')).options).toEqual([])
    const rule = blockAt(editor.state.doc, editor.state.doc.child(0).nodeSize)!
    expect(rule.node.type.name).toBe('horizontalRule')
    expect(turns(editor.state.doc, rule.pos).options).toEqual([])
  })

  it('leaves the cursor at the end of a block moved from its menu, or the block selected if it has no text', () => {
    const editor = open('Uno\n\nDos\n\n---')
    const pos = block(editor, 'Dos')
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)))
    moveBlock(editor, pos, -1)
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
    editor.commands.insertContent('!')
    expect(saved(editor)).toBe('Dos!\n\nUno\n\n---')
    let rule = -1
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === 'horizontalRule') rule = offset
    })
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, rule)))
    moveBlock(editor, rule, -1)
    expect((editor.state.selection as NodeSelection).node?.type.name).toBe('horizontalRule')
    expect(saved(editor)).toBe('Dos!\n\n---\n\nUno')
  })

  it('finds a list item from right before it, as over its bullet or checkbox', () => {
    const editor = open('- uno\n- dos\n\n- [ ] tarea')
    const item = block(editor, 'dos')
    expect(blockAt(editor.state.doc, item)?.node.textContent).toBe('dos')
    const task = block(editor, 'tarea')
    expect(blockAt(editor.state.doc, task)?.node.type.name).toBe('taskItem')
  })

  it('never moves a block below the empty paragraph the editor keeps at the end', () => {
    const editor = open('Uno\n\n## Fin')
    const fin = block(editor, 'Fin')
    expect(canMove(editor.state.doc, fin, 1)).toBe(false)
    expect(moveBlock(editor, fin, 1)).toBe(false)
    expect(saved(editor)).toBe('Uno\n\n## Fin')
  })

  it('leaves the cursor in text after a delete, never the front matter selected', () => {
    const editor = open('---\ntitle: x\n---\n\nUno\n\nDos')
    deleteBlock(editor, block(editor, 'Uno'))
    editor.commands.insertContent('X')
    expect(saved(editor)).toBe('---\ntitle: x\n---\n\nXDos')
  })

  it('turns a nested item into text out of every list, and a quote into what it holds', () => {
    const editor = open('- uno\n  - dentro\n- dos\n\n> - a\n> - b')
    turnBlock(editor, block(editor, 'dentro'), 'p')
    let quote = -1
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === 'blockquote') quote = offset
    })
    expect(turns(editor.state.doc, quote).current).toBe('quote')
    turnBlock(editor, quote, 'p')
    // The quote's list meets the list before it: one list, as Markdown would read them anyway.
    expect(saved(editor)).toBe('- uno\n\ndentro\n\n- dos\n- a\n- b')
  })

  it('makes one list of two lists of the same kind that a move brings together', () => {
    const editor = open('- a\n\nEntre\n\n- b\n\n1. uno')
    moveBlock(editor, block(editor, 'Entre'), 1)
    expect(saved(editor)).toBe('- a\n- b\n\nEntre\n\n1. uno')
  })

  it('offers no heading for text of several lines, and no code for text with an image', () => {
    const editor = open('```\nuno\ndos\n```\n\nTexto ![i](/x.png) y más')
    expect(turns(editor.state.doc, block(editor, 'uno')).options).toEqual(['p', 'code'])
    expect(turns(editor.state.doc, block(editor, 'Texto')).options).not.toContain('code')
  })

  it('opens the menu with Ctrl+/ also where «/» is Shift+7, without making a numbered list', () => {
    const editor = new Editor({ extensions: [...documentExtensions(), BlockKeys], content: 'Hola', contentType: 'markdown' })
    editors.push(editor)
    const opened: number[] = []
    ;(editor.storage as unknown as { blockKeys: { openMenu: (pos: number) => void } }).blockKeys.openMenu = (pos) => opened.push(pos)
    editor.commands.setTextSelection(3)
    const key = new KeyboardEvent('keydown', { key: '/', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
    Object.defineProperty(key, 'keyCode', { value: 55 })
    editor.view.dom.dispatchEvent(key)
    expect(opened).toEqual([0])
    expect(editor.getMarkdown().trim()).toBe('Hola')
  })

  it('leaves two front matters where they are, edit after edit', () => {
    const editor = open('---\ntitle: x\n---\n\nUno')
    const front = editor.state.doc.firstChild!
    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, front.type.create({ markdown: '---\ntitle: otra\n---' })))
    const before = editor.getMarkdown()
    editor.commands.setTextSelection(editor.state.doc.firstChild!.nodeSize + 2)
    editor.commands.insertContent('a')
    expect(editor.getMarkdown().indexOf('title: x')).toBe(before.indexOf('title: x'))
    editor.commands.insertContent('b')
    expect(editor.getMarkdown().indexOf('title: x')).toBe(before.indexOf('title: x'))
  })

  it('turns an item into text also in a list of another kind', () => {
    const editor = open('- uno\n  - [ ] t\n- dos')
    expect(turnBlock(editor, block(editor, 't'), 'p')).toBe(true)
    expect(editor.state.doc.textContent).toContain('t')
    expect(saved(editor)).not.toContain('[ ]')
  })

  it('keeps front matter at the top whatever is put before it', () => {
    const editor = open('---\ntitle: x\n---\n\nUno')
    const { schema } = editor.state
    editor.view.dispatch(editor.state.tr.insert(0, schema.nodes.paragraph!.create(null, schema.text('Antes'))))
    expect(editor.getMarkdown().trim()).toBe('---\ntitle: x\n---\n\nAntes\n\nUno')
  })

  it('undoes each action alone, apart from what was typed', () => {
    const editor = open('Uno\n\nDos')
    editor.commands.setTextSelection(TextSelection.atEnd(editor.state.doc).from)
    editor.commands.insertContent('!')
    moveBlock(editor, block(editor, 'Dos'), -1)
    duplicateBlock(editor, block(editor, 'Uno'))
    editor.commands.undo()
    expect(saved(editor)).toBe('Dos!\n\nUno')
    editor.commands.undo()
    expect(saved(editor)).toBe('Uno\n\nDos!')
  })
})
