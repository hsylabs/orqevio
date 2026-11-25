// @vitest-environment jsdom
import { Editor, type JSONContent } from '@tiptap/core'
import { undoDepth } from '@tiptap/pm/history'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import katex from 'katex'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { documentExtensions } from '../src/features/docs/editor/markdown'
import { markdownToHtml } from '../src/features/docs/editor/markdown-html'
import { MathKeys, insertMath, mathStorage, readBlockMath, readInlineMath, selectionToMath, setMath } from '../src/features/docs/editor/math'

// Formulas in LaTeX, drawn by KaTeX: in a line as `$…$` (or GitHub's $`…`$), of their own between
// `$$` or in a fence of `math`. Each one written back as it was; a `$` of text never becomes one.
const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))

function open(content: string | JSONContent, contentType: 'markdown' | 'html' | 'json' = 'markdown', mounted = false) {
  const element = mounted ? document.body.appendChild(document.createElement('div')) : undefined
  const editor = new Editor({ element, extensions: [...documentExtensions(), MathKeys], content, contentType: contentType === 'json' ? undefined : contentType })
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
const latexOf = (editor: Editor) => {
  const found: string[] = []
  editor.state.doc.descendants((node) => void (node.type.name.endsWith('Math') && found.push(String(node.attrs.latex))))
  return found
}
const saved = (editor: Editor) => editor.getMarkdown().trimEnd()
const paragraph = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content }] })
const text = (value: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
const formula = (latex: string): JSONContent => ({ type: 'inlineMath', attrs: { latex } })

describe('a formula in Markdown', () => {
  it.each([
    ['in a line', 'La energía es $E = mc^2$, como se sabe.', ['E = mc^2']],
    ['alone in a line', '$\\frac{a}{b}$', ['\\frac{a}{b}']],
    ['with a dollar inside', 'Cuesta $\\$4 + x$ en total', ['\\$4 + x']],
    ['as GitHub writes one with Markdown in it', 'Así: $`a * b * c`$ y sigue', ['a * b * c']],
    ['two in a row', '$a$$b$', ['a', 'b']],
    ['bold, in italics, struck and linked', '**$x$**, *$y$*, ~~$z$~~ y [la $w$](https://a.test)', ['x', 'y', 'z', 'w']],
    ['in bold text', '**antes $x$ después**', ['x']],
    ['in a heading', '## La fórmula $x^2$', ['x^2']],
    ['in a list', '- uno $a$\n- dos $b$', ['a', 'b']],
    ['between $$ in a line, as typed in the editor', 'Esto $$x$$ en línea', ['x']],
    ['of its own, between $$ lines', 'Antes\n\n$$\n\\sum_{i=1}^{n} x_i\n$$\n\nDespués', ['\\sum_{i=1}^{n} x_i']],
    ['of its own, on several lines', '$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$', ['\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}']],
    ['of its own, on one line', '$$x^2 + y^2 = z^2$$', ['x^2 + y^2 = z^2']],
    ['of its own, in a fence of math', '```math\n\\sqrt{2}\n```', ['\\sqrt{2}']],
    ['of its own, in a fence of tildes', '~~~~math\n\\sqrt{2}\n~~~~', ['\\sqrt{2}']],
    ['of its own, in a list item', '- uno\n  $$\n  x\n  $$\n- dos', ['x']],
    ['of its own, in a quote', '> $$\n> x\n> $$', ['x']],
    ['of its own, in a callout', '> [!NOTE]\n> $$\n> x\n> $$', ['x']],
    ['of its own, in a toggle', '<details>\n<summary>Demostración</summary>\n\n$$\nx\n$$\n\n</details>', ['x']],
  ])('is a formula, written back as it was: %s', (_name, markdown, latex) => {
    const editor = open(markdown)
    expect(latexOf(editor)).toEqual(latex)
    expect(editor.getMarkdown()).toBe(markdown)
  })

  it.each([
    ['prices', 'Cuesta $5 y luego $10, o 20 €'],
    ['a price and a formula', 'Pagué $5 por $x$', 1],
    ['a dollar alone', 'Un $ suelto y otro $'],
    ['a dollar with spaces inside', 'Esto $ no es $ fórmula'],
    ['a number right after the last dollar', 'De $5 a $10 son $5$6'],
    ['inline code', 'Usa `$x$` y `$$y$$`'],
    ['a code block', '```bash\necho "$HOME $$"\n```'],
    ['$$ lines with a blank line between them', '$$\nx\n\ny\n$$'],
    ['$$ lines with nothing between them', '$$\n$$'],
    ['$$ with nothing between them in a line', 'Esto $$ $$ no'],
  ])('stays as it was where it is no formula, or one only where it is: %s', (_name, markdown, count = 0) => {
    const editor = open(markdown)
    expect(latexOf(editor)).toHaveLength(count)
    expect(editor.getMarkdown()).toBe(markdown)
  })

  it('reads an escaped dollar as a dollar, and writes it plain where it opens nothing', () => {
    const editor = open('Precio \\$5, y \\$x\\$ escapado. Otro \\$5 aquí')
    expect(latexOf(editor)).toEqual([])
    expect(editor.getText()).toBe('Precio $5, y $x$ escapado. Otro $5 aquí')
    // The first one, plain, would open a formula up to the `$` after x.
    expect(saved(editor)).toBe('Precio \\$5, y \\$x$ escapado. Otro $5 aquí')
    expect(open(saved(editor)).getText()).toBe('Precio $5, y $x$ escapado. Otro $5 aquí')
  })

  it('is one of its own right under a line of text, as a fence is, with a blank line between them once saved', () => {
    const editor = open('Texto\n$$\nx\n$$')
    expect(types(editor)).toEqual(['paragraph', 'text', 'blockMath'])
    expect(saved(editor)).toBe('Texto\n\n$$\nx\n$$')
    expect(saved(open(saved(editor)))).toBe('Texto\n\n$$\nx\n$$')
  })

  it('stays a formula in a table, its pipe escaped, the same from the first save on', () => {
    const editor = open('| a | b |\n| --- | --- |\n| $\\lvert x \\rvert$ y $a\\|b$ | c |')
    expect(latexOf(editor)).toEqual(['\\lvert x \\rvert', 'a|b'])
    const once = saved(editor)
    expect(once).toContain('| $\\lvert x \\rvert$ y $a\\|b$ |')
    expect(saved(open(once))).toBe(once)
  })

  it('stays a formula of its own in a list item written loose, the same from the first save on', () => {
    const once = saved(open('- uno\n\n  $$\n  x\n  $$'))
    expect(latexOf(open(once))).toEqual(['x'])
    expect(saved(open(once))).toBe(once)
  })

  it('leaves a fence of math with nothing in it, or never closed, a block of code', () => {
    for (const markdown of ['```math\n```', '```math\nx']) {
      const editor = open(markdown)
      expect(types(editor)).toContain('codeBlock')
      expect(latexOf(editor)).toEqual([])
    }
  })

  it('reads $…$ and $$…$$ as GitHub and Pandoc do', () => {
    expect(readInlineMath('$x$ y')).toEqual({ raw: '$x$', latex: 'x' })
    expect(readInlineMath('$ x$')).toBeNull()
    expect(readInlineMath('$x $')).toBeNull()
    expect(readInlineMath('$x$2')).toBeNull()
    expect(readInlineMath('$5 y $x$')).toBeNull()
    expect(readInlineMath('$`a$b`$')).toEqual({ raw: '$`a$b`$', latex: 'a$b' })
    expect(readInlineMath('$a\n\nb$')).toBeNull()
    expect(readBlockMath('$$\nx\n$$\nmás')).toEqual({ raw: '$$\nx\n$$', latex: 'x' })
    expect(readBlockMath('$$x$$ más')).toBeNull()
  })
})

describe('text with a dollar written in the editor', () => {
  it('stays text, escaped only where it would open a formula', () => {
    for (const [typed, written] of [
      ['Cuesta $5 y $10', 'Cuesta $5 y $10'],
      ['La $x$ escrita', 'La \\$x$ escrita'],
      ['$$x$$', '\\$\\$x$$'],
      ['Es $$x$$ en línea', 'Es \\$\\$x$$ en línea'],
      ['$`a`$', '\\$\\`a\\`$'],
      ['a$ $b', 'a$ $b'],
    ]) {
      const editor = open(paragraph(text(typed!)), 'json')
      expect(saved(editor), typed).toBe(written)
      const read = open(saved(editor))
      expect(read.getText(), typed).toBe(typed)
      expect(latexOf(read), typed).toEqual([])
    }
  })

  it('reads back as written, with formulas, marks and escapes around it in any order', () => {
    // Every arrangement of a few pieces next to each other: the document read back is the same.
    const pieces: JSONContent[] = [text('$'), text('a$'), text('$ '), text('5'), text('$x'), text('\\'), text('`'), text('$b', [{ type: 'link', attrs: { href: 'https://a.test' } }]), formula('y'), formula('a $b')]
    // One editor's Markdown, as getMarkdown and the page's reading use it; the Markdown a formula was
    // read from is kept apart from what it is.
    const editor = open('')
    const markdown = editor.markdown!
    const plain = (json: JSONContent) => JSON.parse(JSON.stringify(json).replace(/,"raw":(?:null|"(?:[^"\\]|\\.)*")/g, ''))
    let checked = 0
    for (const a of pieces) {
      for (const b of pieces) {
        for (const c of pieces) {
          const doc = editor.schema.nodeFromJSON(paragraph(a, b, c)).toJSON() as JSONContent
          const written = markdown.serialize(doc)
          expect(plain(editor.schema.nodeFromJSON(markdown.parse(written)).toJSON()), JSON.stringify(written)).toEqual(plain(doc))
          checked++
        }
      }
    }
    expect(checked).toBe(1000)
  })

  it('writes a formula followed by a digit as GitHub\'s $`…`$, which ends before it', () => {
    const editor = open(paragraph(formula('x'), text('2 veces')), 'json')
    expect(saved(editor)).toBe('$`x`$2 veces')
    expect(latexOf(open(saved(editor)))).toEqual(['x'])
  })
})

describe('a formula changed in the editor', () => {
  it('takes its new source, in the form it was written in', () => {
    const cases: Array<[string, string, string]> = [
      ['La $x$ fórmula', 'y^2', 'La $y^2$ fórmula'],
      ['La $`x`$ fórmula', 'y', 'La $y$ fórmula'],
      ['La $x$ fórmula', 'a $ b', 'La $`a $ b`$ fórmula'],
      ['$$\nx\n$$', '\\frac{1}{2}', '$$\n\\frac{1}{2}\n$$'],
      ['$$x$$', 'y', '$$y$$'],
      ['$$x$$', 'a\nb', '$$\na\nb\n$$'],
      ['```math\nx\n```', 'y', '```math\ny\n```'],
      ['~~~math\nx\n~~~', 'y', '~~~math\ny\n~~~'],
      ['$$\nx\n$$', 'a\n$$\nb', '```math\na\n$$\nb\n```'],
    ]
    for (const [markdown, source, written] of cases) {
      const editor = open(markdown)
      const pos = Math.max(first(editor, 'inlineMath'), first(editor, 'blockMath'))
      setMath(editor, pos, source)
      expect(saved(editor), markdown).toBe(written)
      expect(open(saved(editor)).getMarkdown().trimEnd(), markdown).toBe(written)
    }
  })

  it('keeps one in a line on one line, and one of its own without blank lines', () => {
    const editor = open('A $x$ y\n\n$$\nx\n$$')
    setMath(editor, first(editor, 'inlineMath'), '  a\n  + b  ')
    setMath(editor, first(editor, 'blockMath'), '\na\n\n\nb\n\n')
    expect(saved(editor)).toBe('A $a + b$ y\n\n$$\na\nb\n$$')
  })

  it('goes once its source is empty', () => {
    const editor = open('A $x$ y\n\n$$\nx\n$$\n\nFin')
    setMath(editor, first(editor, 'blockMath'), '  ')
    setMath(editor, first(editor, 'inlineMath'), '')
    expect(saved(editor)).toBe('A  y\n\nFin')
  })

  it('changes nothing for a source left as it was, nor how it was written', () => {
    const editor = open('A $a\nb$ y', 'markdown', true)
    const steps = undoDepth(editor.state)
    setMath(editor, first(editor, 'inlineMath'), 'a\nb')
    expect(undoDepth(editor.state)).toBe(steps)
    expect(saved(editor)).toBe('A $a\nb$ y')
  })

  it('is changed as one step each time, undone on its own; after it the cursor follows one in a line, and one of its own stays selected', () => {
    const editor = open('A $x$ y\n\n$$\nx\n$$', 'markdown', true)
    const steps = undoDepth(editor.state)
    setMath(editor, first(editor, 'inlineMath'), 'a')
    const inline = first(editor, 'inlineMath')
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
    expect(editor.state.selection.from).toBe(inline + 1)
    setMath(editor, first(editor, 'blockMath'), 'b')
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)
    expect(editor.state.selection.from).toBe(first(editor, 'blockMath'))
    expect(undoDepth(editor.state)).toBe(steps + 2)
    editor.commands.undo()
    expect(saved(editor)).toBe('A $a$ y\n\n$$\nx\n$$')
    editor.commands.undo()
    expect(saved(editor)).toBe('A $x$ y\n\n$$\nx\n$$')
  })
})

describe('a new formula', () => {
  it('goes in a line where the cursor is, with the cursor after it', () => {
    const editor = open('Antes después', 'markdown', true)
    insertMath(editor, 7, 'e^{i\\pi}', false)
    expect(saved(editor)).toBe('Antes $e^{i\\pi}$después')
    expect(editor.state.selection.from).toBe(8)
  })

  it('goes of its own instead of an empty line, or splitting the line at the cursor, selected', () => {
    const empty = open('Uno\n\n<p></p>\n\nDos', 'markdown', true)
    empty.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [text('Uno')] }, { type: 'paragraph' }, { type: 'paragraph', content: [text('Dos')] }] })
    insertMath(empty, 6, 'x', true)
    expect(saved(empty)).toBe('Uno\n\n$$\nx\n$$\n\nDos')
    expect(empty.state.selection).toBeInstanceOf(NodeSelection)
    const split = open('Antes después', 'markdown', true)
    insertMath(split, 6, 'x', true)
    expect(saved(split)).toBe('Antes\n\n$$\nx\n$$\n\n después')
    expect(types(split)).toEqual(['paragraph', 'text', 'blockMath', 'paragraph', 'text'])
  })

  it('goes of its own in an empty item of a list, which keeps its line', () => {
    const editor = open({ type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }] }, 'json', true)
    insertMath(editor, 3, 'x', true)
    expect(editor.state.doc.check()).toBeUndefined()
    expect(latexOf(editor)).toEqual(['x'])
  })

  it('takes the text selected as its source, as one step, and opens its field (Ctrl+Shift+E)', () => {
    const editor = open('La fórmula a^2 + b^2 aquí', 'markdown', true)
    const edit = vi.fn()
    mathStorage(editor)!.edit = edit
    mathStorage(editor)!.create = vi.fn()
    const steps = undoDepth(editor.state)
    editor.commands.setTextSelection({ from: 12, to: 21 })
    expect(selectionToMath(editor)).toBe(true)
    expect(saved(editor)).toBe('La fórmula $a^2 + b^2$ aquí')
    expect(undoDepth(editor.state)).toBe(steps + 1)
    expect(edit).toHaveBeenCalledWith(12)
  })

  it('opens the field of the one selected with Enter, instead of replacing it', () => {
    const editor = open('A $x$ y', 'markdown', true)
    const edit = vi.fn()
    mathStorage(editor)!.edit = edit
    const pos = first(editor, 'inlineMath')
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)))
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(edit).toHaveBeenCalledWith(pos)
    expect(saved(editor)).toBe('A $x$ y')
  })
})

describe('a formula as it is shown', () => {
  it('is drawn by KaTeX in the editor, its source where it has a mistake', () => {
    const editor = open('A $x^2$ y $\\frac{1}{$\n\n$$\n\\sqrt{2}\n$$', 'markdown', true)
    const shown = editor.view.dom.querySelectorAll<HTMLElement>('.orq-math')
    expect(shown).toHaveLength(3)
    expect(shown[0]!.querySelector('.katex')).not.toBeNull()
    expect(shown[1]!.classList.contains('orq-math--error')).toBe(true)
    expect(shown[1]!.textContent).toBe('\\frac{1}{')
    expect(shown[2]!.classList.contains('orq-math--block')).toBe(true)
    expect(shown[2]!.querySelector('.katex-display')).not.toBeNull()
    setMath(editor, first(editor, 'inlineMath'), 'y')
    expect(editor.view.dom.querySelector('.orq-math annotation')!.textContent).toBe('y')
  })

  it('is drawn in a comment, and in print, as in the editor', () => {
    const html = markdownToHtml('Una $x^2$ y\n\n$$\n\\sqrt{2}\n$$')
    expect(html).toContain('<span data-latex="x^2" data-type="inline-math" class="orq-math"><span class="katex">')
    expect(html).toContain('class="orq-math orq-math--block"><span class="katex-display">')
    expect(html).toContain('<math')
  })

  it('never runs or links what a formula holds', () => {
    for (const markdown of ['$\\href{javascript:alert(1)}{x}$', '$\\url{javascript:alert(1)}$', '$\\htmlClass{x}{y}$', '$\\htmlData{onclick=alert(1)}{y}$', '$\\htmlId{x}{y}$', '$\\includegraphics{https://a.test/x.png}$', '$<img src=x onerror=alert(1)>$']) {
      const box = document.createElement('div')
      box.innerHTML = markdownToHtml(markdown)
      expect(box.querySelector('a, img, [href], [src]'), markdown).toBeNull()
      const attributes = [...box.querySelectorAll('*')].flatMap((element) => element.getAttributeNames())
      expect(attributes.filter((name) => /^on|^data-(?!latex$|type$)|^id$/.test(name)), markdown).toEqual([])
    }
  })

  it('comes back the same through copy and paste, also from a comment', () => {
    for (const markdown of ['Una $x^2$ y $`a*b`$', '$$\n\\sqrt{2}\n$$', '**$x$**']) {
      expect(open(open(markdown).getHTML(), 'html').getMarkdown().trimEnd()).toBe(markdown.replace('$`a*b`$', '$a*b$'))
      expect(open(markdownToHtml(markdown), 'html').getMarkdown().trimEnd()).toBe(markdown.replace('$`a*b`$', '$a*b$'))
    }
  })

  it('is pasted from a page that draws formulas with KaTeX or MathML, as its TeX source', () => {
    const inline = katex.renderToString('a^2 + b^2', { output: 'htmlAndMathml' })
    const display = katex.renderToString('\\sum x', { output: 'htmlAndMathml', displayMode: true })
    const mathml = '<math><semantics><mi>x</mi><annotation encoding="application/x-tex">x_1</annotation></semantics></math>'
    const editor = open(`<p>Una ${inline} y ${mathml}</p>${display}`, 'html')
    expect(saved(editor)).toBe('Una $a^2 + b^2$ y $x_1$\n\n$$\n\\sum x\n$$')
  })
})
