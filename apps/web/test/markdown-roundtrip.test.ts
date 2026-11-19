// @vitest-environment jsdom
import { Editor, type JSONContent } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { documentExtensions } from '../src/features/docs/editor/markdown'

// The editor saves the whole document again on every edit, so whatever it reads must be
// written back as it was: Markdown → editor → Markdown, with the real document extensions.
const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))
function open(content: string | JSONContent) {
  const editor = new Editor({ extensions: documentExtensions(), content, contentType: typeof content === 'string' ? 'markdown' : undefined })
  editors.push(editor)
  return editor
}
const roundTrip = (markdown: string) => open(markdown).getMarkdown()

/** Written back exactly as it was. */
const kept: Array<[string, string]> = [
  ['headings 4 to 6', '#### Cuatro\n\n##### Cinco\n\n###### Seis'],
  ['headings 1 to 3', '# Uno\n\n## Dos\n\n### Tres'],
  ['an image inside text', 'Texto con ![icono](/api/attachments/x.png) en línea'],
  ['an image alone', '![captura](/api/attachments/x.png)'],
  ['a linked badge', '[![build](https://img.shields.io/badge/a.svg)](https://ci.example.com)'],
  ['badges in a row', '[![a](https://x.test/a.svg)](https://a.test) [![b](https://x.test/b.svg)](https://b.test)'],
  ['an HTML block with Markdown inside', '<details>\n<summary>Más</summary>\n\nDentro **negrita**\n\n</details>'],
  ['a div', '<div align="center">\n  <img src="logo.png" width="80">\n</div>'],
  ['inline HTML', 'Un <span style="color:red">rojo</span>, <kbd>Ctrl</kbd> y <br> salto'],
  ['an HTML comment', '<!-- comentario -->\n\nTexto'],
  ['escaped block markers', '\\# no es título\n\n1\\. no es lista\n\n2\\) tampoco\n\n\\- ni esto\n\n\\+ ni esto\n\n\\> ni cita\n\n\\---'],
  ['ampersands and angle brackets', 'AT&T, a < b > c, x<3 y R&D'],
  ['entities that must stay entities', '&amp;lt; y &amp;nbsp; y \\<div>'],
  ['non-breaking spaces', 'antes&nbsp;después'],
  ['inline code keeps its text', 'Usa `a <b> & c` y `**no**`'],
  ['a code block keeps its text', '```html\n<div>&nbsp; & </div>\n```'],
  ['emphasis', '**negrita**, *cursiva*, ~~tachado~~ y `código`'],
  ['escaped emphasis', '\\*no\\* y \\_tampoco\\_'],
  ['links', '[Orqevio](https://orqevio.com) y [con título](https://a.test "Título")'],
  ['links to a card and a page', 'Ver [Revisar contrato](/card/0b6f3c1e-2a7e-4d6b-9f3a-1c2d3e4f5a6b) y [Guía](/doc/1b6f3c1e-2a7e-4d6b-9f3a-1c2d3e4f5a6b)'],
  ['bullet lists', '- uno\n- dos\n  - dentro'],
  ['ordered lists', '1. uno\n2. dos'],
  ['task lists', '- [ ] pendiente\n- [x] hecha'],
  ['quotes', '> cita\n> larga'],
  ['rules', 'Antes\n\n---\n\nDespués'],
  ['accents and emoji', 'Canción ñandú 🎉 日本語'],
  ['a code block that shows a fence', '````md\n```js\nconst a = 1\n```\n````\n\nDespués'],
  ['a code block with backticks inside a line', '```\na ```b\n```'],
  ['YAML front matter', '---\ntitle: Hola\ntags: [a, b]\n---\n\nTexto'],
  ['TOML front matter', '+++\ntitle = "Hola"\n+++\n\nTexto'],
  ['a rule at the start, which is not front matter', '---\n\nTexto\n\n---\n\nMás'],
  ['tasks inside an ordered list', '1. paso\n   - [ ] a\n   - [x] b\n2. otro'],
  ['a list inside an ordered list', '1. paso\n   - a\n   - b\n2. otro'],
  ['links with spaces in the address', 'Ver [y](</ruta con espacios>) y [z](<https://a.test/x y>)'],
  ['a link with parentheses in the address', '[Foo](https://es.wikipedia.org/wiki/Foo_(bar))'],
  ['footnotes', 'Texto con nota[^1] y otra[^web].\n\n[^1]: La nota.\n\n[^web]: https://orqevio.com'],
  ['a footnote of several lines', 'Uno[^larga], dos.\n\n[^larga]: Primera línea\n    y la segunda, sangrada.'],
  ['front matter alone', '---\ntitle: Hola\n---'],
  ['tasks under a two-digit item', '10. diez\n    - [ ] a\n    - [x] b\n11. once'],
  ['an ordered list inside another', '1. uno\n   1. sub\n   2. sub dos\n2. dos'],
]

/** Read the same again: written in another, equivalent way. */
const normalised: Array<[string, string, string]> = [
  ['named entities become their characters', 'Copyright &copy; y caf&eacute;', 'Copyright © y café'],
  ['an unclosed tag is escaped', 'a <b sin cerrar', 'a \\<b sin cerrar'],
  ['front matter gets a blank line after it', '---\ntitle: Hola\n---\nTexto', '---\ntitle: Hola\n---\n\nTexto'],
  ['an item with a parenthesis is written with a dot, its tasks side by side', '1) paso\n   - [ ] a\n   - [x] b', '1. paso\n   - [ ] a\n   - [x] b'],
  ['a code block in an ordered list keeps its indentation', '1. paso\n\n   ```js\n   const a = 1\n   ```\n2. otro', '1. paso\n   ```js\n   const a = 1\n   ```\n2. otro'],
  [
    'a code block in an ordered list keeps a line that looks like an item',
    '1. paso\n\n   ```python\n   def f():\n       x = 1\n       1. + 2\n       return x\n   ```\n2. otro',
    '1. paso\n   ```python\n   def f():\n       x = 1\n       1. + 2\n       return x\n   ```\n2. otro',
  ],
  [
    'a code block in an ordered list keeps a line like an item at its margin',
    '1. paso\n\n   ~~~\n   2. no es un paso\n   ~~~\n2. otro',
    '1. paso\n   ```\n   2. no es un paso\n   ```\n2. otro',
  ],
]

describe('Markdown round trip', () => {
  it.each(kept)('keeps %s', (_name, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown)
    // Saved again, it stays the same: nothing drifts a little more on each save.
    expect(roundTrip(roundTrip(markdown))).toBe(markdown)
  })

  it.each(normalised)('%s', (_name, markdown, written) => {
    expect(roundTrip(markdown)).toBe(written)
    // And from then on it stays put.
    expect(roundTrip(written)).toBe(written)
  })

  it('keeps tables, with their HTML, the same from the second save on', () => {
    const first = roundTrip('| a | b |\n| --- | --- |\n| x<br>y | z |')
    expect(first).toContain('x<br>y')
    expect(roundTrip(first)).toBe(first)
  })

  it('writes text that looks like Markdown so it reads back as text', () => {
    // What the editor shows as plain text, e.g. after undoing a list or pasting Markdown as text.
    const lines = ['# título', '- lista', '+ lista', '1. lista', '1) lista', '> cita', '---', '- - -', '===']
    for (const line of lines) {
      const editor = open({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: line }] }] })
      const markdown = editor.getMarkdown()
      expect(open(markdown).getJSON().content, `${line} → ${markdown}`).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: line }] }])
    }
  })

  it('keeps an image whose name has brackets an image', () => {
    const image = { type: 'image', attrs: { src: '/api/attachments/a.png', alt: 'captura [final].png', title: null } }
    const markdown = open({ type: 'doc', content: [{ type: 'paragraph', content: [image] }] }).getMarkdown()
    expect(markdown).toBe('![captura \\[final\\].png](/api/attachments/a.png)')
    expect(open(markdown).getJSON().content?.[0]?.content?.[0]).toMatchObject(image)
  })

  it('keeps empty paragraphs between paragraphs', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }, { type: 'paragraph' }, { type: 'paragraph' }, { type: 'paragraph', content: [{ type: 'text', text: 'B' }] }],
    }
    const markdown = open(doc).getMarkdown()
    expect(open(markdown).getMarkdown()).toBe(markdown)
  })

  it('shows HTML as its source and never runs it', () => {
    const editor = open('<img src=x onerror="window.hacked=1">\n\nY <img src=y onerror="window.hacked=2"> aquí')
    const dom = editor.view.dom
    expect(dom.querySelector('img')).toBeNull()
    expect([...dom.querySelectorAll('[data-raw-html]')].map((el) => el.textContent)).toEqual(['<img src=x onerror="window.hacked=1">', '<img src=y onerror="window.hacked=2">'])
    expect((window as { hacked?: number }).hacked).toBeUndefined()
  })
})
