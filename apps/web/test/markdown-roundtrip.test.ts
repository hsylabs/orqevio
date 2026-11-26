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
  ['a private-use character in an ordered list, as an icon font uses', '1. paso \uE000 con icono\n   - [ ] a\n2. otro'],
  ['tasks under a two-digit item', '10. diez\n    - [ ] a\n    - [x] b\n11. once'],
  ['an ordered list inside another', '1. uno\n   1. sub\n   2. sub dos\n2. dos'],
  ['a GitHub alert', '> [!NOTE]\n> Algo importante'],
  ['the other GitHub alerts', '> [!TIP]\n> Un consejo\n\n> [!IMPORTANT]\n> Clave\n\n> [!WARNING]\n> Ojo\n\n> [!CAUTION]\n> Peligro'],
  ['an alert of several paragraphs, with a list', '> [!WARNING]\n> Antes de seguir:\n>\n> - haz una copia\n> - cierra las pestañas'],
  ['an Obsidian callout with a title, folded', '> [!tip]- Un truco\n> Dentro'],
  ['an alert inside a list', '- paso\n  > [!NOTE]\n  > Dentro de la lista'],
  ['brackets later in a quote stay escaped', '> Texto \\[!NOTE\\] en medio\n>\n> \\[!TIP\\] en otro párrafo'],
  ['an alert marker escaped on purpose, to show how one is written', '> \\[!NOTE\\]\n> Así se escribe un aviso'],
  // Escaped where they came from, these stay so; written from the editor, see the test of text typed after a marker.
  ['an escaped marker followed by a colon', '> \\[!NOTE\\]: Importante'],
  ['an escaped marker followed by a colon and an address', '> \\[!TIP\\]: /guia "Guía"'],
  ['an escaped marker followed by parentheses', '> \\[!NOTE\\](importante) algo'],
  ['a rule under the text of an item', '- uno\n\n  ---\n- dos'],
  ['a rule under the text of a numbered item', '1. uno\n\n   ---\n2. dos'],
  ['a rule under the text of a task', '- [ ] uno\n\n  ---\n- [ ] dos'],
  ['an empty item of a numbered list', '1. uno\n2.\n3. tres'],
  ['an empty first item of a numbered list', '1.\n2. dos'],
  ['an empty last item of a numbered list', '1. uno\n2.'],
  ['a number alone on its line, an empty numbered item as Markdown reads it', '2024.'],
  ['an empty item of a bulleted list', '- uno\n-\n- tres'],
  ['an empty first item of a bulleted list', '-\n- b'],
  ['an empty bulleted list after text', 'Texto\n\n-'],
  ['a line like an empty item in a code block of a numbered list', '1. paso\n   ```\n   2.\n   ```\n2. otro'],
  ['a quote at the start of an item', '- > cita\n  > x'],
  ['a quote as one item of several', '- a\n- > cita\n- c'],
  ['a quote at the start of a numbered item', '1. > cita'],
  ['a quote of two lines at the start of a numbered item', '1. > cita\n   > x'],
  ['a quote as one numbered item of several', '1. uno\n2. > cita\n3. tres'],
  ['a quote at the start of a numbered item inside another', '1. a\n   1. > cita\n2. b'],
  ['an alert at the start of an item', '- > [!NOTE]\n  > Aviso'],
  ['an alert at the start of a numbered item', '1. > [!NOTE]\n   > Aviso'],
  ['a link to a reference and its definition', 'Texto con [enlace][a].\n\n[a]: https://example.com'],
  ['links to references, full and collapsed, and their definitions with a title', 'Ver [docs][r] y [otro][].\n\n[r]: https://r.test\n[otro]: https://o.test "Título"'],
  ['a definition before the shortcut link to it', '[a]: https://example.com\n\nTexto [a].'],
  ['definitions apart, one unused, and a label in capitals', 'Uno [x][a] dos [y][A].\n\n[a]: https://a.test\n\n[b]: https://b.test'],
  ['a link to a reference in a task', '- [ ] ver [docs][r]\n\n[r]: https://r.test'],
  ['a link to a reference in an item', '- ver [docs][r]\n\n[r]: https://r.test'],
  ['a link to a reference in a numbered item', '1. ver [docs][r]\n\n[r]: https://r.test'],
  ['a link to a reference and its definition in a quote', '> Cita con [x][a].\n>\n> [a]: https://a.test'],
  ['a link to a reference with marks, its address between angle brackets', "Texto [**negrita**][a].\n\n[a]: <https://a.test/con espacio> 'T'"],
  ['links to references next to each other, and one followed by another label', 'Ver [a] [b] y [a][b].\n\n[a]: https://a.test\n[b]: https://b.test'],
  ['two definitions of a label, the first counting', '[a]: https://a.test\n[a]: https://otra.test\n\nVer [a].'],
  ['emphasis around a link to a reference whose text holds its mark', '*x [b\\*][a] y*\n\n[a]: https://a.test'],
  ['a definition in an item, after its text', '[t][a]\n\n- x\n\n  [a]: https://a.test'],
  ['a definition at the start of an item', '- [a]: https://a.test'],
  ['a definition in a task, after its text', '- [ ] x\n\n  [a]: https://a.test'],
  ['a definition in a numbered item, after its text', '1. x\n\n   [a]: https://a.test'],
  ['a definition at the start of a numbered item', '1. [a]: https://a.test'],
  ['an empty quote', '>'],
  ['an empty quote between paragraphs', 'Texto\n\n>\n\nMás'],
  ['an empty quote inside a quote', '> a\n>\n> >'],
]

/** Read the same again: written in another, equivalent way. */
const normalised: Array<[string, string, string]> = [
  ['a marker with only its closing bracket escaped stays escaped', '> [!NOTE\\]\n> Así se escribe', '> \\[!NOTE\\]\n> Así se escribe'],
  ['a marker with its exclamation mark escaped stays escaped', '> [\\!NOTE]\n> Así se escribe', '> \\[!NOTE\\]\n> Así se escribe'],
  ['a marker written with an entity stays escaped', '> &#91;!NOTE]\n> Así se escribe', '> \\[!NOTE\\]\n> Así se escribe'],
  ['a quote loses its empty first line, and an escaped marker after it stays escaped', '>\n> \\[!NOTE\\]\n> Así se escribe', '> \\[!NOTE\\]\n> Así se escribe'],
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
  // The editor writes a list's items one under the other (`- a\n\n- b` is `- a\n- b`).
  ['a rule under the text of an item, with blank lines around it', '- uno\n\n  ---\n\n- dos', '- uno\n\n  ---\n- dos'],
  ['a rule of stars under the text of an item', '- uno\n\n  ***', '- uno\n\n  ---'],
  ['an empty numbered item between blank lines stays in its list', '1. uno\n\n2.\n\n3. tres', '1. uno\n2.\n3. tres'],
  ['an empty numbered item with a space after its number', '1. uno\n2. \n3. tres', '1. uno\n2.\n3. tres'],
  ['an empty bulleted item with a space after its marker', '- uno\n- \n- tres', '- uno\n-\n- tres'],
  // Stuck to the text, marked and GitHub read a heading there, even in a task.
  ['a rule right under the text of a task', '- [ ] uno\n  ---', '- [ ] uno\n\n  ---'],
  // As Markdown reads them: what is not indented under an empty item is no part of it.
  ['text right under an empty numbered item', '1. uno\n2.\ntexto', '1. uno\n2.\n\ntexto'],
  ['a year alone on its line, then text', '2024.\nFue un buen año.', '2024.\n\nFue un buen año.'],
  // A block right under an empty item is its own, after a line of `&nbsp;`, as with any item that starts with a block.
  ['a list right under an empty numbered item', '1. uno\n2.\n   - a\n3. tres', '1. uno\n2. &nbsp;\n   - a\n3. tres'],
  ['an empty item in a list inside another', '- a\n  1.\n  2. b', '- a\n  1. &nbsp;\n  2. b'],
  // An item indented otherwise than the first, by up to three spaces, is one more of the list's items, as Markdown reads it.
  ['an item indented a space more than the first', '1. a\n 2. b\n3. c', '1. a\n2. b\n3. c'],
  ['an item less indented than the first', ' 1. a\n2. b', '1. a\n2. b'],
  ['an item indented less than the text of a long number', '10. a\n   2. b', '10. a\n11. b'],
  ['items indented otherwise under an empty item', '1. Paso uno\n2.\n  1. a\n  2. b\n3. Paso tres', '1. Paso uno\n2.\n3. a\n4. b\n5. Paso tres'],
  ['an item indented a space more under an empty item', '1. a\n2.\n 3. b', '1. a\n2.\n3. b'],
  ['an item after an empty first item indented more', '  2.\n1. x', '2.\n3. x'],
  ['an item after text under an indented empty item', ' 1.\n    texto\n2. uno', '1. texto\n2. uno'],
  ['an empty item indented a space more, right under an item', '1. a\n 2.\n3. b', '1. a\n2.\n3. b'],
  ['an empty item indented a space more, under an empty one', '2)\n 2)', '2.\n3.'],
  ['an item of a list inside another, less indented than the first', '1. a\n      2. dos\n   3. uno', '1. a\n   2. dos\n   3. uno'],
  ['an item of a list inside another, under a long number', '12. Ver\n       1. uno\n    2. uno', '12. Ver\n    1. uno\n    2. uno'],
  ['an item of a list inside another, a space more than the first', '1. a\n   1. b\n    2. c\n2. d', '1. a\n   1. b\n   2. c\n2. d'],
  ['an item less indented than a first one four spaces in', '    1. a\n2. b', '1. a\n2. b'],
  ['an item after a blank line under an empty item, as far in as its text', '1. a\n2.\n\n   3. b', '1. a\n2.\n3. b'],
  // What is under an item put in line with the others moves with it.
  ['a list under an item moved in line', '1. a\n  2. b\n     - c\n     - d', '1. a\n2. b\n   - c\n   - d'],
  ['a code block under an item moved in line', '1. a\n  2. b\n\n     ```py\n     if x:\n         y\n     ```', '1. a\n2. b\n   ```py\n   if x:\n       y\n   ```'],
  ['a code block under an item moved right', '  1. a\n2. b\n   ```\n   2. x\n   ```\n3. c', '1. a\n2. b\n   ```\n   2. x\n   ```\n3. c'],
  ['text under an item moved in line, a space past its text', '2) dos\n  3. b\n    c', '2. dos\n3. b\nc'],
  // Letters and roman numerals are TipTap's: not CommonMark's, they stay where they were.
  ['lettered items under a numbered one', '1. Paso uno\n  a. detalle\n  b. detalle', '1. Paso uno\n   a. detalle\n   b. detalle'],
  // A number alone can't break into a paragraph (CommonMark): under a task's text, it goes on with it.
  ['a number alone under the text of a task', '- [ ] Llamar\n  2.\n  Revisar', '- [ ] Llamar\n  2\\.\n  Revisar'],
  ['numbered lines far in under an item', '- dos\n          1. a\n          2. b', '- dos\n  1. a\n  2. b'],
  // A fence one to three spaces in is a fence (CommonMark).
  ['a code block indented a few spaces', 'Texto\n\n   ```\n   x\n   ```', 'Texto\n\n```\nx\n```'],
  ['a code block indented less than the text of an empty item', '1. Instala:\n2.\n  ```bash\n  npm i\n  ```', '1. Instala:\n2.\n\n```bash\nnpm i\n```'],
  // marked reads a list whose number has only spaces after it again in a quote, with the lines after it.
  ['a numbered item with only a space after its number in a quote, with a line after it', '> 2. \n>    b\ntexto', '> 2. b\n> texto'],
  ['a numbered item with only a space after its number in a quote, with a heading under it', '> 2. \n>    ## h\ntexto', '> 2. &nbsp;\n>    ## h\n>\n> texto'],
  ['an empty quote in an item, after a blank line', '- a\n\n  >', '- a\n  >'],
  // Written `[texto][]` or `[texto]` only where the text is written as its label is.
  ['a link to a reference whose label is escaped in its text', 'Ver [a_b][].\n\n[a_b]: https://a.test', 'Ver [a\\_b][a_b].\n\n[a_b]: https://a.test'],
  ['a shortcut link to a reference whose label is escaped in its text', 'Ver [a*b].\n\n[a*b]: https://a.test', 'Ver [a\\*b][a*b].\n\n[a*b]: https://a.test'],
  ['a shortcut link to a reference followed by parentheses', 'Ver [a]\\(b).\n\n[a]: https://a.test', 'Ver [a][](b).\n\n[a]: https://a.test'],
  ['a shortcut link to a reference followed by a colon at the start of a line', '[a]\\: b\n\n[a]: https://a.test', '[a][]: b\n\n[a]: https://a.test'],
  ['a definition with a heading right under it', '[a]: https://a.test\n## Siguiente', '[a]: https://a.test\n\n## Siguiente'],
  // A definition can't break into a paragraph: there it is text, as marked reads it.
  ['a line like a definition going on with a quote', '> cita [a]\n[a]: https://a.test', '> cita \\[a\\]\n> \\[a\\]: [https://a.test](https://a.test)'],
  ['a quote at the start of a numbered item, and a line that goes on with it', '1. > cita\ntexto', '1. > cita\n   > texto'],
  ['a numbered item four spaces in in a quote, with a line after it', '>     1. a\nx y', '> 1. a\n> x y'],
  ['numbered items five spaces in in a quote, with a line after them', '>      1. a\n>      2. b\nx y', '> 1. a\n> 2. b\n> x y'],
  // A number alone further in than the list's own items is a line of the block it is in, as it was.
  ['a number alone in a code block indented less than the item', '1. Crea el script:\n  ```bash\n  case "$x" in\n    1)\n      echo uno ;;\n  esac\n  ```\n2. Ejecútalo', '1. Crea el script:\n   ```bash\n   case "$x" in\n    1)\n      echo uno ;;\n   esac\n   ```\n2. Ejecútalo'],
  ['a number alone in a formula in an item', '1. paso\n   $$\n   x\n   2.\n   $$\n2. otro', '1. paso\n   ```math\n   x\n   2.\n   ```\n2. otro'],
  ['a number alone indented as code is code', 'Texto\n\n    2.', 'Texto\n\n```\n2.\n```'],
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

  it('reads every item with a first line to write in, as the editor makes them', () => {
    for (const markdown of ['1. uno\n2.\n   - a\n3. tres', '1. uno\n2.\n   ```js\n   x\n   ```\n3. tres', '1. uno\n2.\n   > cita\n3. tres', '- a\n  1.\n  2. b', '> 2.\n> texto', '1.\n\n   foo', '2024.\nFue un buen año.', '- a\n  - [ ] t\n    x\n    2.\n    a']) {
      const editor = open(markdown)
      expect(() => editor.state.doc.check(), markdown).not.toThrow()
      expect(roundTrip(roundTrip(markdown)), markdown).toBe(roundTrip(markdown))
    }
  })

  it('reads text left bare in an item as a line of it', () => {
    for (const markdown of ['- a\n  > 2. uno\n  4. uno\n\n     fue', '- a\n  > b\n\n  c']) {
      const editor = open(markdown)
      expect(() => editor.state.doc.check(), markdown).not.toThrow()
      expect(roundTrip(roundTrip(markdown)), markdown).toBe(roundTrip(markdown))
    }
  })

  it('writes a link to a reference in line once its address or its definition changes, and by its label once its text does', () => {
    const markdown = 'Ver [a] y [b][] y [c][r].\n\n[a]: https://a.test\n[b]: https://b.test\n[r]: https://r.test'
    const edited = (change: (doc: JSONContent) => void) => {
      const doc = open(markdown).getJSON()
      change(doc)
      return open(doc).getMarkdown()
    }
    const texts = (doc: JSONContent) => doc.content![0]!.content!
    const link = (node: JSONContent) => node.marks!.find((mark) => mark.type === 'link')!
    // Its text changed: `[a]` and `[b][]` named their definitions by their text.
    expect(edited((doc) => { texts(doc)[1]!.text = 'x'; texts(doc)[3]!.text = 'y' })).toBe('Ver [x][a] y [y][b] y [c][r].\n\n[a]: https://a.test\n[b]: https://b.test\n[r]: https://r.test')
    // Its address changed: the definition no longer says where it goes.
    expect(edited((doc) => { link(texts(doc)[5]!).attrs!.href = 'https://otra.test' })).toBe('Ver [a] y [b][] y [c](https://otra.test).\n\n[a]: https://a.test\n[b]: https://b.test\n[r]: https://r.test')
    // A mark on its text: the text is no longer written as its label.
    expect(edited((doc) => { texts(doc)[1]!.marks!.push({ type: 'bold' }) })).toBe('Ver [**a**][a] y [b][] y [c][r].\n\n[a]: https://a.test\n[b]: https://b.test\n[r]: https://r.test')
    // Its definition is gone.
    expect(edited((doc) => { doc.content!.pop() })).toBe('Ver [a](https://a.test) y [b](https://b.test) y [c](https://r.test).')
  })

  it('reads an empty item as an empty line to write in, as the editor makes one', () => {
    for (const markdown of ['1. uno\n2.\n3. tres', '1. uno\n2. \n3. tres', '1. uno\n\n2.\n\n3. tres', '- uno\n-\n- tres']) {
      const editor = open(markdown)
      expect(() => editor.state.doc.check(), markdown).not.toThrow()
      expect(editor.state.doc.childCount, markdown).toBe(1)
      const items = editor.getJSON().content![0]!.content!.map((item) => item.content)
      expect(items, markdown).toEqual([[{ type: 'paragraph', content: [{ type: 'text', text: 'uno' }] }], [{ type: 'paragraph' }], [{ type: 'paragraph', content: [{ type: 'text', text: 'tres' }] }]])
    }
  })

  it('keeps two tables in a row apart by one blank line, save after save', () => {
    const tables = '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\n| c   |\n| --- |\n| 3   |'
    expect(roundTrip(tables)).toBe(tables)
    expect(roundTrip(roundTrip(roundTrip(tables)))).toBe(tables)
    // Written by hand, without the padding: the first save pads it, and from then on it stays.
    const first = roundTrip('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n| c |\n| --- |\n| 3 |')
    expect(first).toBe(tables)
  })

  it('keeps two tables in a row in a quote, save after save', () => {
    const quoted = '> | a   |\n> | --- |\n> | 1   |\n>\n> | b   |\n> | --- |\n> | 2   |'
    expect(roundTrip(quoted)).toBe(quoted)
    expect(roundTrip(roundTrip(roundTrip(quoted)))).toBe(quoted)
  })

  it('keeps tables, with their HTML, the same from the second save on', () => {
    const first = roundTrip('| a | b |\n| --- | --- |\n| x<br>y | z |')
    expect(first).toContain('x<br>y')
    expect(roundTrip(first)).toBe(first)
  })

  it('keeps the lines after a heading or HTML in a list item as they are, save after save', () => {
    for (const markdown of ['- a\n\n  ## H\n\n  tras **b** y snake_case', '- uno\n\n  <div>x</div>\n\n  tras **b**']) {
      const first = roundTrip(markdown)
      expect(first).toContain('tras **b**')
      expect(roundTrip(first)).toBe(first)
      expect(roundTrip(roundTrip(first))).toBe(first)
    }
  })

  it('keeps an item of only a non-breaking space, and an empty line at the end of an item, as they were', () => {
    for (const markdown of ['- &nbsp;\n- b', '- &nbsp;\n  - b', '- a\n- &nbsp;', '> - &nbsp;\n> - b', '- a\n  ```\n  x\n  ```\n\n  \n- b']) {
      expect(roundTrip(markdown)).toBe(markdown)
      expect(roundTrip(roundTrip(markdown))).toBe(markdown)
    }
  })

  it('keeps a task list with a table at the end of an item one list', () => {
    const first = roundTrip('- [ ] a\n\n  | t |\n  | --- |\n  | x |\n- [x] b')
    expect(open(first).getJSON().content?.map((node) => node.type)).toEqual(['taskList'])
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

  it('writes an alert typed in a quote as an alert, and reads it back as the same text', () => {
    // GitHub shows an alert when its marker is alone on the first line of the quote.
    const alert: JSONContent = {
      type: 'blockquote',
      attrs: { escapedMarker: false },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '[!NOTE]' }, { type: 'hardBreak' }, { type: 'text', text: 'Recuerda' }] }],
    }
    const markdown = open({ type: 'doc', content: [alert] }).getMarkdown()
    expect(markdown).toBe('> [!NOTE]  \n> Recuerda')
    expect(open(markdown).getJSON().content).toEqual([alert])
  })

  it('keeps a marker escaped on purpose when its quote is copied and pasted', () => {
    // jsdom has no ClipboardEvent, which pasting makes when it is not given one.
    const missing = typeof ClipboardEvent === 'undefined'
    if (missing) (globalThis as { ClipboardEvent?: unknown }).ClipboardEvent = class extends Event {}
    try {
      // Paragraphs apart: pasting turns a line break inside one into a hard break, as it always has.
      for (const markdown of ['> \\[!NOTE\\]\n>\n> Así se escribe', '> [!NOTE]\n>\n> Un aviso de verdad']) {
        const source = open(markdown)
        const { dom } = source.view.serializeForClipboard(source.state.doc.slice(0, source.state.doc.content.size))
        const target = open('')
        target.view.pasteHTML(dom.innerHTML)
        expect(target.getMarkdown().trim()).toBe(markdown)
      }
    } finally {
      if (missing) delete (globalThis as { ClipboardEvent?: unknown }).ClipboardEvent
    }
  })

  it('keeps text typed after a marker in a quote as text', () => {
    // Followed by `:` or `(`, the marker would turn into something else if it were written unescaped.
    for (const text of ['[!NOTE]: Importante', '[!NOTE]: /ruta "Título"', '[!NOTE](importante)', '[!WARNING]:x']) {
      const quote: JSONContent = { type: 'blockquote', attrs: { escapedMarker: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
      const markdown = open({ type: 'doc', content: [quote] }).getMarkdown()
      expect(open(markdown).getJSON().content?.[0]?.content, `${text} → ${markdown}`).toEqual(quote.content)
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

  it('shows HTML as its source and never runs it, an <img> as an image without its other attributes', () => {
    const markdown = '<img src=x onerror="window.hacked=1">\n\nY <img src=y onerror="window.hacked=2"> aquí <b onclick="window.hacked=3">b</b>'
    const editor = open(markdown)
    const dom = editor.view.dom
    const images = [...dom.querySelectorAll('img[src]')]
    expect(images.map((img) => img.getAttribute('src'))).toEqual(['x', 'y'])
    expect(images.some((img) => img.hasAttribute('onerror'))).toBe(false)
    expect([...dom.querySelectorAll('[data-raw-html]')].map((el) => el.textContent)).toEqual(['<b onclick="window.hacked=3">', '</b>'])
    expect((window as { hacked?: number }).hacked).toBeUndefined()
    expect(editor.getMarkdown()).toBe(markdown)
  })
})
