// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { undoDepth } from '@tiptap/pm/history'
import { NodeSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import { codeColoursLoaded, loadCodeColours } from '../src/features/docs/editor/code-languages'
import { documentExtensions } from '../src/features/docs/editor/markdown'

// Apart from the other tests: here the colours are not loaded yet when the editor opens.
const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))

describe('an editor opened before the colours came', () => {
  it('draws its code blocks again with them, without a change to save or undo, and keeps a block selected', async () => {
    expect(codeColoursLoaded()).toBe(false)
    const element = document.createElement('div')
    document.body.append(element)
    const editor = new Editor({ element, extensions: documentExtensions(), content: 'Antes\n\n```ts\nconst a = 1\n```', contentType: 'markdown' })
    editors.push(editor)
    let pos = -1
    editor.state.doc.forEach((node, offset) => node.type.name === 'codeBlock' && (pos = offset))
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)))
    expect(element.querySelector('.hljs-keyword')).toBeNull()
    const steps = undoDepth(editor.state)
    await loadCodeColours()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(element.querySelector('.hljs-keyword')?.textContent).toBe('const')
    expect(element.querySelector('.orq-code-lang')?.textContent).toBe('TypeScript')
    expect(undoDepth(editor.state)).toBe(steps)
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)
    expect(editor.state.selection.from).toBe(pos)
  })
})
