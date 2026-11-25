// @vitest-environment jsdom
import { Editor, type JSONContent } from '@tiptap/core'
import { undoDepth } from '@tiptap/pm/history'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import katex from 'katex'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { documentExtensions } from '../src/features/docs/editor/markdown'
import { markdownToHtml } from '../src/features/docs/editor/markdown-html'
import { type InlineFormula, MathKeys, blockMathStart, insertMath, markDollars, markFormula, mathStorage, readBlockMath, readInlineMath, selectionToMath, setMath, settleDollars } from '../src/features/docs/editor/math'

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
    // Without the space at the split, which would start the line after it.
    expect(saved(split)).toBe('Antes\n\n$$\nx\n$$\n\ndespués')
    expect(types(split)).toEqual(['paragraph', 'text', 'blockMath', 'paragraph', 'text'])
  })

  it('goes of its own in an empty item of a list, which keeps its line and its list', () => {
    const editor = open(
      { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }, { type: 'paragraph', content: [text('fin')] }] },
      'json',
      true,
    )
    insertMath(editor, 3, 'x', true)
    expect(editor.state.doc.check()).toBeUndefined()
    expect(types(editor)).toEqual(['bulletList', 'listItem', 'paragraph', 'blockMath', 'paragraph', 'text'])
    expect(saved(editor)).toBe('- $$\n  x\n  $$\n\nfin')
    expect(saved(open(saved(editor)))).toBe('- $$\n  x\n  $$\n\nfin')
  })

  it('keeps the marks of the text it goes in, or of the text it is made of', () => {
    const link = [{ type: 'link', attrs: { href: 'https://a.test' } }]
    const inLink = open(paragraph(text('ver ', link), text('docs', link)), 'json', true)
    insertMath(inLink, 5, 'x', false)
    expect(saved(inLink)).toBe('[ver $x$docs](https://a.test)')
    const made = open(paragraph(text('ver a^2 aquí', link)), 'json', true)
    mathStorage(made)!.edit = vi.fn()
    made.commands.setTextSelection({ from: 5, to: 8 })
    selectionToMath(made)
    expect(saved(made)).toBe('[ver $a^2$ aquí](https://a.test)')
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
    for (const markdown of ['$\\href{javascript:alert(1)}{x}$', '$\\url{javascript:alert(1)}$', '$\\htmlClass{x}{y}$', '$\\htmlData{onclick=alert(1)}{y}$', '$\\htmlId{x}{y}$', '$\\includegraphics{https://a.test/x.png}$']) {
      const box = document.createElement('div')
      box.innerHTML = markdownToHtml(markdown)
      expect(box.querySelector('.orq-math'), markdown).not.toBeNull()
      expect(box.querySelector('a, img, [href], [src]'), markdown).toBeNull()
      const attributes = [...box.querySelectorAll('*')].flatMap((element) => element.getAttributeNames())
      expect(attributes.filter((name) => /^on|^data-(?!latex$|type$)|^id$/.test(name)), markdown).toEqual([])
    }
    // A whole tag between dollars is the tag, as Markdown reads it first: an image (images.test.ts), without what it would run.
    const box = document.createElement('div')
    box.innerHTML = markdownToHtml('$<img src=x onerror=alert(1)>$')
    expect([...box.querySelectorAll('*')].flatMap((element) => element.getAttributeNames()).filter((name) => /^on/.test(name))).toEqual([])
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

describe('a formula where Markdown reads it otherwise', () => {
  it('starting an item of a list, stays on its marker line, the list and all', () => {
    for (const markdown of ['- $$x$$', '- $$\n  x\n  $$', '- a\n  - $$x$$', '- ```js\n  code\n  ```']) {
      const editor = open(markdown)
      expect(saved(editor), markdown).toBe(markdown)
      expect(types(editor)[0], markdown).toBe('bulletList')
    }
  })

  it('in a task, is written as a fence of math, which TipTap reads there; $$ lines under its text stay its text', () => {
    const loose = open('- [ ] tarea\n\n  $$\n  x\n  $$')
    expect(saved(loose)).toBe('- [ ] tarea\n  ```math\n  x\n  ```')
    expect(latexOf(open(saved(loose)))).toEqual(['x'])
    for (const markdown of ['- [ ] tarea\n  $$\n  x\n  $$', '- [ ] $$x$$ y']) expect(saved(open(markdown)), markdown).toBe(markdown)
  })

  it('in a list, is written as a fence when a line of it would start an item', () => {
    const editor = open('1. Paso\n\n   $$\n   x\n   $$')
    setMath(editor, first(editor, 'blockMath'), '1. a\n2. b')
    expect(saved(editor)).toBe('1. Paso\n   ```math\n   1. a\n   2. b\n   ```')
    expect(latexOf(open(saved(editor)))).toEqual(['1. a\n2. b'])
  })

  it('written as $$…$$ in a line, stays so before a digit, and is $…$ where it would be one of its own', () => {
    expect(saved(open('a $$x$$5 b'))).toBe('a $$x$$5 b')
    const alone = open('Esto $$x$$ en línea')
    alone.commands.setContent(paragraph(formula('x')))
    const raw = open('Esto $$x$$ en línea')
    const pos = first(raw, 'inlineMath')
    raw.view.dispatch(raw.state.tr.delete(pos + 1, raw.state.doc.content.size - 1).delete(1, pos))
    expect(saved(raw)).toBe('$x$')
    expect(types(open(saved(raw)))).toEqual(['paragraph', 'inlineMath'])
    for (const markdown of ['Texto  \n$$x$$', 'Texto\n$$x$$ y']) {
      const editor = open(markdown)
      expect(latexOf(editor), markdown).toEqual(['x'])
    }
  })

  it('next to a dollar of text, reads back as it was', () => {
    for (const content of [[formula('x'), text('$')], [formula('x'), text('$5')], [text('$'), formula('x')], [formula('x'), text('2')]]) {
      const editor = open(paragraph(...content), 'json')
      const read = open(saved(editor))
      expect(read.getText(), saved(editor)).toBe(editor.getText())
      expect(latexOf(read), saved(editor)).toEqual(latexOf(editor))
    }
  })

  it('in italics, bold or struck with their delimiters in it, or in a link with brackets, is written as $`…`$', () => {
    const italic = [{ type: 'italic' }]
    const bold = [{ type: 'bold' }]
    const strike = [{ type: 'strike' }]
    const link = [{ type: 'link', attrs: { href: 'https://a.test' } }]
    const cases: Array<[JSONContent[], string]> = [
      [[text('valor ', italic), { ...formula('x^*'), marks: italic }, text(' fin', italic)], '*valor $`x^*`$ fin*'],
      [[text('a ', bold), { ...formula('b**c'), marks: bold }], '**a $`b**c`$**'],
      [[text('a ', strike), { ...formula('b~~c'), marks: strike }], '~~a $`b~~c`$~~'],
      [[text('see ', link), { ...formula('[0,1)'), marks: link }], '[see $`[0,1)`$](https://a.test)'],
    ]
    for (const [content, written] of cases) {
      const editor = open(paragraph(...content), 'json')
      expect(saved(editor)).toBe(written)
      const read = open(written)
      expect(latexOf(read), written).toEqual(latexOf(editor))
      expect(read.getText(), written).toBe(editor.getText())
    }
  })

  it('in a heading or a table, is written on one line; in a table, with its double bars as \\Vert', () => {
    const heading = open({ type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [text('A '), formula('a\nb'), text(' y')] }] }, 'json')
    expect(saved(heading)).toBe('## A $a b$ y')
    const table = open('| a | b |\n| --- | --- |\n| x | y |')
    const cell = first(table, 'paragraph') + 1
    table.view.dispatch(table.state.tr.insert(cell, table.schema.nodes.inlineMath!.create({ latex: '\\|v\\|\nw' })))
    expect(saved(table)).toContain('$\\Vert v\\Vert w$')
    expect(latexOf(open(saved(table)))).toEqual(['\\Vert v\\Vert w'])
  })

  it('of its own in a table\'s cell, is written as one in its line', () => {
    const table = open('| a |\n| --- |\n| x |')
    const cell = first(table, 'tableCell')
    table.view.dispatch(table.state.tr.insert(cell + 1, table.schema.nodes.blockMath!.create({ latex: 'x^2\n+ 1' })))
    const once = saved(table)
    expect(once).toContain('$x^2 + 1$')
    expect(saved(open(once))).toBe(once)
  })

  it('never crosses a code span or a link\'s address after a price', () => {
    for (const markdown of ['Cuesta $5; ejecuta `A=$B` antes', 'Cuesta $5, ver [docs](https://api.test/items?$top=10) hoy']) {
      const editor = open(markdown)
      expect(latexOf(editor), markdown).toEqual([])
      expect(saved(editor), markdown).toBe(markdown)
    }
  })

  it('is no formula of its own when a line holds two of them, or more after one', () => {
    for (const markdown of ['$$a$$ and $$b$$', '$$x$$$']) {
      const editor = open(markdown)
      expect(types(editor), markdown).not.toContain('blockMath')
      expect(saved(editor), markdown).toBe(markdown)
    }
  })

  it('looks for a formula of its own only in the paragraph it is asked about', () => {
    const long = Array.from({ length: 4000 }, (_, i) => `Párrafo ${i} con texto.`).join('\n\n') + '\n\n$$\nx\n$$'
    const started = performance.now()
    for (let i = 0; i < 4000; i++) blockMathStart(long.slice(i * 10))
    expect(performance.now() - started).toBeLessThan(2000)
  })
})

describe('the field of a formula', () => {
  /** The editor with its field, mounted; `type` writes in the field as a person does. */
  async function withField(content: string) {
    const element = document.body.appendChild(document.createElement('div'))
    const editor = new Editor({ element, extensions: [...documentExtensions(), MathKeys], content, contentType: 'markdown' })
    editors.push(editor)
    const { createRoot } = await import('react-dom/client')
    const { act } = await import('react')
    const { MathControls } = await import('../src/features/docs/editor/MathControls')
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(createElement(MathControls, { editor })))
    const field = () => host.querySelector('textarea')
    const type = async (value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field()!, value)
        field()!.dispatchEvent(new Event('input', { bubbles: true }))
      })
    const enter = async () => act(async () => void field()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    const replace = async (markdown: string) => act(async () => void editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false }))
    return { editor, act, field, type, enter, replace, unmount: () => act(async () => root.unmount()) }
  }
  const nth = (editor: Editor, n: number) => {
    const found: number[] = []
    editor.state.doc.descendants((node, pos) => void (node.type.name === 'inlineMath' && found.push(pos)))
    return found[n]!
  }

  it('keeps what was typed when the page is read again whole, its formula found again, the caret where it was', async () => {
    const page = await withField('A $x$ y')
    await page.act(async () => mathStorage(page.editor)!.edit!(first(page.editor, 'inlineMath')))
    await page.type('x^2')
    page.field()!.setSelectionRange(1, 1)
    await page.replace('Antes. A $x$ y')
    expect(page.field()!.value).toBe('x^2')
    expect(page.field()!.selectionStart).toBe(1)
    await page.enter()
    expect(saved(page.editor)).toBe('Antes. A $x^2$ y')
    await page.unmount()
  })

  it('changes the one of two alike it was opened for, and closes when it can no longer tell', async () => {
    const page = await withField('Sea $n$ par y $n$ impar.')
    await page.act(async () => mathStorage(page.editor)!.edit!(nth(page.editor, 1)))
    await page.type('m')
    await page.replace('Antes.\n\nSea $n$ par y $n$ impar.')
    await page.enter()
    expect(saved(page.editor)).toBe('Antes.\n\nSea $n$ par y $m$ impar.')
    await page.unmount()
    // The one it was for went, and one alike stays: it can't tell which, and nothing is changed.
    const twin = await withField('A $x$ y\n\nB $x$ z')
    await twin.act(async () => mathStorage(twin.editor)!.edit!(nth(twin.editor, 0)))
    await twin.type('y^2')
    await twin.replace('B $x$ z')
    expect(twin.field()).toBeNull()
    expect(saved(twin.editor)).toBe('B $x$ z')
    await twin.unmount()
  })

  it('changes the formula first in the page only while it is the same one', async () => {
    const page = await withField('$$\na\n$$\n\n$$\nb\n$$')
    await page.act(async () => mathStorage(page.editor)!.edit!(first(page.editor, 'blockMath')))
    await page.type('z')
    await page.replace('$$\nb\n$$')
    expect(page.field()).toBeNull()
    expect(saved(page.editor)).toBe('$$\nb\n$$')
    await page.unmount()
  })

  it('puts a new one in the line it was opened in when the page is read again whole, not at its top', async () => {
    const page = await withField('Uno dos tres\n\nCuatro cinco')
    const cursor = page.editor.state.doc.child(0).nodeSize + 1 + 'Cuatro'.length
    await page.act(async () => mathStorage(page.editor)!.create!(cursor, false))
    await page.type('x^2')
    await page.replace('Uno dos tres\n\nCuatro cinco')
    await page.enter()
    expect(saved(page.editor)).toBe('Uno dos tres\n\nCuatro$x^2$ cinco')
    await page.unmount()
  })
})

describe('what a second look found', () => {
  it('writes an item of a numbered list that starts with a block with its marker on a line of its own, as TipTap reads it', () => {
    for (const second of [{ type: 'blockMath', attrs: { latex: 'x' } }, { type: 'codeBlock', attrs: { language: 'js' }, content: [text('code')] }]) {
      const doc = { type: 'doc', content: [{ type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }, second] }] }] }
      const editor = open(doc, 'json')
      expect(saved(editor), second.type).toMatch(/^1\. &nbsp;\n {3}/)
      expect(types(open(saved(editor))), saved(editor)).toEqual(types(editor))
    }
    // Any other block first in an item, in a bulleted list too.
    const quote = open({ type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }, { type: 'blockquote', content: [{ type: 'paragraph', content: [text('q')] }] }] }] }] }, 'json')
    expect(saved(quote)).toBe('- &nbsp;\n  > q')
    expect(saved(open(saved(quote)))).toBe('- &nbsp;\n  > q')
  })

  it('goes into a numbered item from the editor and comes back the same', () => {
    const editor = open({ type: 'doc', content: [{ type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }] }, 'json', true)
    insertMath(editor, 3, 'x', true)
    expect(latexOf(open(saved(editor)))).toEqual(['x'])
  })

  it('keeps Markdown an agent wrote around marks as it was', () => {
    for (const markdown of ['**$x_1$** y *$x_1$*', '[$f(x)$](https://a.test)', '~~$a~b$~~ y **$a*b$**']) expect(saved(open(markdown)), markdown).toBe(markdown)
  })

  it('leaves one in a line of a task\'s text one in its line, also after a line break', () => {
    const doc = { type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [text('a'), { type: 'hardBreak' }, { type: 'inlineMath', attrs: { latex: 'x', raw: '$$x$$' } }] }] }] }] }
    const editor = open(doc, 'json')
    const read = open(saved(editor))
    expect(types(read), saved(editor)).not.toContain('blockMath')
    expect(latexOf(read)).toEqual(['x'])
  })

  it('in a table\'s cell, reads its dollars as the table writes them, line breaks as <br>', () => {
    const table = open('| a |\n| --- |\n| x |')
    const cell = first(table, 'tableCell') + 1
    const paragraph = table.schema.nodes.paragraph!.create(null, [table.schema.text('5$'), table.schema.nodes.hardBreak!.create(), table.schema.text('3$')])
    table.view.dispatch(table.state.tr.replaceWith(cell, cell + table.state.doc.nodeAt(cell)!.nodeSize, paragraph))
    const read = open(saved(table))
    expect(latexOf(read), saved(table)).toEqual([])
    expect(saved(read)).toBe(saved(table))
  })

  it('keeps $$…$$ where it can\'t be one of its own: a table\'s cell, a numbered item\'s first line', () => {
    for (const markdown of ['| $$x$$ |\n| ----- |\n| b     |', '1. $$x$$\n2. dos', '- a\n  1. $$x$$']) expect(saved(open(markdown)), markdown).toBe(markdown)
  })

  it('keeps one of its own on one line as it was, with a line after it', () => {
    for (const [markdown, written] of [
      ['$$x$$\nTexto', '$$x$$\n\nTexto'],
      ['> $$x$$\n> más', '> $$x$$\n>\n> más'],
      ['$$x$$\n$$y$$', '$$x$$\n\n$$y$$'],
    ]) {
      expect(saved(open(markdown!)), markdown).toBe(written)
      expect(saved(open(written!)), written).toBe(written)
    }
  })

  it('never crosses an autolink or a whole HTML tag after a price, and still reads a < b', () => {
    expect(latexOf(open('Cuesta $5 <https://a.test/?a$b> hoy'))).toEqual([])
    expect(latexOf(open('Cuesta $5 <span>x$</span> hoy'))).toEqual([])
    expect(latexOf(open('Si $a<b$ y $c>d$'))).toEqual(['a<b', 'c>d'])
  })

  it('goes after the text of a list\'s item it is asked for at its start, the list kept; never in code or a toggle\'s title', () => {
    const editor = open('- abc', 'markdown', true)
    insertMath(editor, 3, 'x', true)
    expect(types(editor)[0]).toBe('bulletList')
    expect(latexOf(editor)).toEqual(['x'])
    const code = open('```\ncode\n```', 'markdown', true)
    expect(insertMath(code, 2, 'x', false)).toBe(false)
    expect(insertMath(code, 2, 'x', true)).toBe(false)
    const toggle = open('<details>\n<summary>Título</summary>\n\nDentro\n\n</details>', 'markdown', true)
    expect(insertMath(toggle, 3, 'x', false)).toBe(false)
  })
})

describe('what a third look found', () => {
  it('writes a formula read in marks as $`…`$ once its source takes their delimiters', () => {
    const cases: Array<[string, string, string]> = [
      ['*valor $y$ fin*', 'x^*', '*valor $`x^*`$ fin*'],
      ['**a $y$**', 'b**c', '**a $`b**c`$**'],
      ['~~a $y$~~', 'b~~c', '~~a $`b~~c`$~~'],
      ['[see $y$](https://a.test)', '[0,1)', '[see $`[0,1)`$](https://a.test)'],
    ]
    for (const [markdown, source, written] of cases) {
      const editor = open(markdown)
      setMath(editor, first(editor, 'inlineMath'), source)
      expect(saved(editor), markdown).toBe(written)
      expect(latexOf(open(written)), written).toEqual([source])
    }
  })

  it('reads inequalities as formulas: only a whole tag, as CommonMark has it, stops one', () => {
    for (const [markdown, latex] of [
      ['Para $0<t \\le T$ y $T>0$.', ['0<t \\le T', 'T>0']],
      ['Sea $p<q r$ con $r>1$', ['p<q r', 'r>1']],
      ['Si $n<k \\cdot m$ y $m>2$', ['n<k \\cdot m', 'm>2']],
    ] as Array<[string, string[]]>) {
      const editor = open(markdown)
      expect(latexOf(editor), markdown).toEqual(latex)
      expect(saved(editor), markdown).toBe(markdown)
    }
  })

  it('writes a table\'s cell of several lines as one, its formulas and pipes as the rest, stable from the first save', () => {
    const table = open('| a | b |\n| --- | --- |\n| x | y |', 'markdown', true)
    const x = first(table, 'tableCell') + 2
    table.view.dispatch(table.state.tr.setSelection(TextSelection.create(table.state.doc, x + 1)))
    table.commands.splitBlock()
    insertMath(table, table.state.selection.from, '|v|', false)
    const once = saved(table)
    const read = open(once)
    expect(latexOf(read), once).toEqual(['|v|'])
    expect(read.getText(), once).toContain('y')
    expect(saved(read)).toBe(once)
    const price = open({ type: 'doc', content: [{ type: 'table', content: [
      { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [text('h')] }] }] },
      { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [text('$5')] }, { type: 'paragraph', content: [text('$$x$$')] }] }] },
    ] }] }, 'json')
    expect(saved(open(saved(price)))).toBe(saved(price))
  })

  it('writes an item read without a line of text first, or with a rule under its empty line, so it reads back', () => {
    for (const markdown of ['1.\n   $$\n   x\n   $$', '1.\n   ```js\n   code\n   ```']) {
      const once = saved(open(markdown))
      expect(saved(open(once)), once).toBe(once)
      expect(latexOf(open(once)).length + (once.includes('```js') ? 1 : 0), once).toBe(1)
    }
    const rule = open({ type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }, { type: 'horizontalRule' }] }] }] }, 'json')
    expect(types(open(saved(rule))), saved(rule)).toContain('horizontalRule')
  })
})

describe('what a fourth look found', () => {
  const cell = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content: [{ type: 'table', content: [
    { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [text('h')] }] }] },
    { type: 'tableRow', content: [{ type: 'tableCell', content }] },
  ] }] })

  it('saves a table\'s cell that holds a list, code or a heading under its text', () => {
    for (const block of [
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('b')] }] }] },
      { type: 'codeBlock', content: [text('c')] },
      { type: 'heading', attrs: { level: 2 }, content: [text('t')] },
      { type: 'horizontalRule' },
    ]) {
      const editor = open(cell({ type: 'paragraph', content: [text('a')] }, block), 'json')
      expect(() => editor.getMarkdown(), block.type).not.toThrow()
    }
  })

  it('escapes only the first line of a table\'s cell of several lines, the same from the first save on', () => {
    const editor = open(cell({ type: 'paragraph', content: [text('a')] }, { type: 'paragraph', content: [text('# b')] }, { type: 'paragraph', content: [text('- c')] }), 'json')
    const once = saved(editor)
    expect(once).toContain('a<br># b<br>- c')
    expect(saved(open(once))).toBe(once)
  })

  it('closes the field of a formula when the page replaced puts one alike where it was', async () => {
    const element = document.body.appendChild(document.createElement('div'))
    const editor = new Editor({ element, extensions: [...documentExtensions(), MathKeys], content: '$$\na\n$$\n\n$$\na\n$$', contentType: 'markdown' })
    editors.push(editor)
    const { createRoot } = await import('react-dom/client')
    const { act } = await import('react')
    const { MathControls } = await import('../src/features/docs/editor/MathControls')
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(createElement(MathControls, { editor })))
    await act(async () => mathStorage(editor)!.edit!(first(editor, 'blockMath')))
    await act(async () => void editor.commands.setContent('$$\na\n$$', { contentType: 'markdown', emitUpdate: false }))
    expect(host.querySelector('textarea')).toBeNull()
    expect(saved(editor)).toBe('$$\na\n$$')
    await act(async () => root.unmount())
  })
})

describe('what the review of the pull request found', () => {
  const link: JSONContent['marks'] = [{ type: 'link', attrs: { href: 'https://example.com' } }]
  const images = (editor: Editor) => {
    const found: string[] = []
    editor.state.doc.descendants((node) => void (node.type.name === 'image' && found.push(String(node.attrs.alt))))
    return found
  }

  const linked = (editor: Editor) => {
    const found: string[] = []
    editor.state.doc.descendants((node) => void (node.marks.some((mark) => mark.type.name === 'link') && found.push(node.textContent)))
    return found.join('')
  }

  it('keeps a link or an image whose text has a `$`, after a price', () => {
    for (const [markdown, inLink] of [
      ['Costs $5 [US$](https://example.com)', 'US$'],
      ['De $5 a [20 US$](https://example.com) y más', '20 US$'],
      ['Costs $5 [a [b] US$](https://example.com)', 'a [b] US$'],
      ['Costs $5 [US$ `]` x](https://example.com)', 'US$ ] x'],
      ['Costs $5 [US$``](https://example.com)', 'US$``'],
    ]) {
      const editor = open(markdown!)
      expect(latexOf(editor), markdown).toEqual([])
      expect(linked(editor), markdown).toBe(inLink)
      // As written, but for the brackets and backticks of its text, which the editor escapes.
      expect(saved(open(saved(editor))), markdown).toBe(saved(editor))
      expect(linked(open(saved(editor))), markdown).toBe(inLink)
    }
    expect(saved(open('Costs $5 [US$](https://example.com)'))).toBe('Costs $5 [US$](https://example.com)')
    const image = open('Costs $5 ![US$](https://example.com/x.png)')
    expect(latexOf(image)).toEqual([])
    expect(images(image)).toEqual(['US$'])
    expect(saved(image)).toBe('Costs $5 ![US$](https://example.com/x.png)')
  })

  it('still reads a formula with brackets, and one before or in a link', () => {
    for (const [markdown, latex] of [
      ['El intervalo $[0,1)$ y $[a, b]$.', ['[0,1)', '[a, b]']],
      ['$\\left[ x \\right)$ y [un enlace](https://example.com)', ['\\left[ x \\right)']],
      ['$[0,1)$ antes de [un enlace](https://example.com) y $[2,3)$', ['[0,1)', '[2,3)']],
      // In a link, as the editor writes it there: a `[` of its own would start the link's text.
      ['[la fórmula $`[0,1)`$](https://example.com)', ['[0,1)']],
      ['$[a [b] c$ y nada más', ['[a [b] c']],
    ] as const) {
      const editor = open(markdown)
      expect(latexOf(editor), markdown).toEqual(latex)
      expect(saved(editor), markdown).toBe(markdown)
    }
  })

  it('writes a link whose text has a `$` as it is, after a price, a formula or a bracket', () => {
    const editor = open(paragraph(text('Costs $5 '), text('US$', link), text(' and '), formula('[0,1)'), text(' '), text('a$', link)), 'json')
    expect(saved(editor)).toBe('Costs $5 [US$](https://example.com) and $[0,1)$ [a$](https://example.com)')
    const read = open(saved(editor))
    expect(latexOf(read)).toEqual(['[0,1)'])
    expect(read.getText()).toBe('Costs $5 US$ and $[0,1)$ a$')
  })

  it('reads back, in any order, prices next to links whose text has a `$` and formulas with brackets', () => {
    const pieces: JSONContent[] = [text('$5 '), text('$'), text('US$', link), text('[a$', link), text('a$ b', link), formula('[0,1)'), formula('y'), text(' ['), text('](x)')]
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
    expect(checked).toBe(729)
  })

  it('writes a paragraph full of prices or formulas in a moment', () => {
    // The page is written at each change: each `$` reads only what it needs of what follows it.
    const markdown = open('').markdown!
    const many = (count: number, ...content: JSONContent[]) => paragraph(...Array.from({ length: count }, () => content).flat())
    for (const [name, doc] of [
      ['prices', paragraph(text('$a '.repeat(20000)))],
      ['a list of prices', many(20000, text('$5.00 item'), { type: 'hardBreak' })],
      ['intervals', many(20000, formula('[0,1)'), text(' y '))],
      ['open brackets', many(20000, formula('[a'))],
      ['inequalities', many(20000, formula('0<t \\le T'), text(' '))],
      ['links after prices', many(20000, text('$5 '), text('US$', link), text(' '))],
      // Each `$` would open a formula up to the last one: all escaped but the last.
      ['dollars one after another', paragraph(text('$a'.repeat(20000)))],
      ['paths', paragraph(text('$HOME_DIR/'.repeat(20000)))],
      ['dollars between words', paragraph(text('$x$y'.repeat(10000)))],
      ['lines of $$', many(20000, text('$$'), { type: 'hardBreak' })],
      ['dollars before brackets', paragraph(text('$[a'.repeat(20000)))],
      ['placeholders', paragraph(text('${a[0]}'.repeat(10000)))],
      ['dollars on lines', paragraph(text('$a\nb'.repeat(10000)))],
      ['dollars on lines broken', many(10000, text('$a'), { type: 'hardBreak' }, text('b'))],
    ] as const) {
      const start = performance.now()
      markdown.serialize(doc)
      expect(performance.now() - start, name).toBeLessThan(2000)
    }
  })
})

describe('what a fifth look found', () => {
  const linked = (editor: Editor) => {
    const found: string[] = []
    editor.state.doc.descendants((node) => void (node.marks.some((mark) => mark.type.name === 'link') && found.push(node.textContent)))
    return found.join('')
  }

  it('keeps a link to a reference whose text has a `$`, after a price', () => {
    for (const markdown of [
      'Costs $5 [US$][r] here\n\n[r]: https://example.com',
      'Costs $5 [US$][] here\n\n[US$]: https://example.com',
      'Costs $5 [US$] here\n\n[us$]: https://example.com',
      'Costs $5 [US$``][r] here\n\n[r]: https://example.com',
      '> Costs $5 [US$][r] here\n>\n> [r]: https://example.com',
    ]) {
      const editor = open(markdown)
      expect(latexOf(editor), markdown).toEqual([])
      expect(linked(editor), markdown).toMatch(/^US\$/)
      // Written as a link of its own (the editor keeps no references), backticks of its text escaped.
      expect(saved(editor), markdown).toMatch(/\[US\$(?:\\`\\`)?\]\(https:\/\/example\.com\)/)
    }
  })

  it('keeps a link to a reference defined on two lines of a quote', () => {
    const editor = open('> Costs $5 [US$ x] here\n>\n> [US$\n> x]: https://example.com')
    expect(latexOf(editor)).toEqual([])
    expect(linked(editor)).toBe('US$ x')
  })

  it('escapes each `$` of text as reading all that follows it would', () => {
    // As settleDollars did before it read only what it needs: each `$` with all of what is written after it.
    const blockStarts = /(?:^|\n)[ \t]*$/
    const reference = (markdown: string, blocks: 'all' | 'none' | 'lines') => {
      let written = ''
      let end = markdown.length
      for (let i = markdown.length - 1; i >= 0; i--) {
        if (markdown[i] !== '\uFDD0' || markdown[i + 1] !== '$') continue
        written = markdown.slice(i + 2, end) + written
        const following = `$${written}`
        const before = markdown.slice(0, i).replace(/[\uFDD0-\uFDD2]/g, '')
        const start = blocks !== 'none' && (blocks === 'all' ? blockStarts : /\n[ \t]*$/).test(before)
        const block = start && readBlockMath(blocks === 'lines' ? following.split('\n', 1)[0]! : following) !== null
        written = (readInlineMath(following) !== null || block ? '\\$' : '$') + written
        end = i
      }
      return markdown.slice(0, end) + written
    }
    let seed = 7
    const next = () => {
      seed = (seed * 48271) % 2147483647
      return seed / 2147483647
    }
    // As the editor writes text: brackets, backticks and underscores escaped; line breaks.
    const pieces = ['a', 'b', ' ', '5', '\\[', '\\]', '\\_', '\\`', '\n', '\\\n', '  \n', '\n\n', 'HOME/', ',', '<b>', '<a', '[x](u)', '`c`', 'x'.repeat(40)]
    for (let n = 0; n < 4000; n++) {
      let markdown = ''
      for (let k = 0, count = 1 + Math.floor(next() * (n % 10 === 0 ? 200 : 30)); k < count; k++) {
        markdown += next() < 0.45 ? markDollars('$') : pieces[Math.floor(next() * pieces.length)]!
      }
      for (const blocks of ['all', 'none', 'lines'] as const) {
        expect(settleDollars(markdown, [], { blocks }), JSON.stringify(markdown)).toBe(reference(markdown, blocks))
      }
    }
  })

  it('reads the formula when no reference has that text', () => {
    expect(latexOf(open('Costs $5 [US$] here'))).toEqual(['5 [US'])
    expect(latexOf(open('El intervalo $[0,1)$ y $(2,3]$.\n\n[a]: https://example.com'))).toEqual(['[0,1)', '(2,3]'])
  })

  it('settles every `$` the same, however little of what follows it reads first', () => {
    // A small random generator, the same at each run: a failure can be run again.
    let seed = 1
    const next = () => {
      seed = (seed * 48271) % 2147483647
      return seed / 2147483647
    }
    const pieces = ['a', ' ', '5', '\\', '`', '\n', ']', '(', '<b>', '<t ', '](', '[', '![', '*', 'x'.repeat(30), '$', '$$', '\\_', 'HOME/']
    const latexes = ['x', 'a$b', '[0,1)', 'a]', 'b<c', '\\$', '`']
    for (let n = 0; n < 3000; n++) {
      const formulas: InlineFormula[] = []
      let markdown = ''
      for (let k = 0, count = 1 + Math.floor(next() * 30); k < count; k++) {
        const roll = next()
        if (roll < 0.3) markdown += markDollars('$')
        else if (roll < 0.4) {
          const latex = latexes[Math.floor(next() * latexes.length)]!
          formulas.push({ latex, raw: next() < 0.5 ? null : `$${latex}$` })
          markdown += markFormula(formulas.length - 1)
        } else markdown += pieces[Math.floor(next() * pieces.length)]
      }
      for (const blocks of ['all', 'later', 'lines', 'none'] as const) {
        expect(settleDollars(markdown, formulas, { blocks, window: 1 }), markdown).toBe(settleDollars(markdown, formulas, { blocks, window: 1e9 }))
      }
    }
  })
})
