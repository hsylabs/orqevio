// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { undoDepth } from '@tiptap/pm/history'
import { afterEach, describe, expect, it } from 'vitest'
import { setImageCaption, setImageWidth } from '../src/features/docs/editor/image'
import { imageAt } from '../src/features/docs/editor/ImageControls'
import { documentExtensions } from '../src/features/docs/editor/markdown'
import { markdownToHtml } from '../src/features/docs/editor/markdown-html'

// Images with a size and a caption: the size as the <img> tag GitHub reads, the caption as the image's
// title. An <img> already in a page is an image too, written back as it was.
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
const first = (editor: Editor, name = 'image') => {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === name) found = pos
    return found === -1
  })
  return found
}
const saved = (editor: Editor) => editor.getMarkdown().trimEnd()
const roundTrip = (markdown: string) => open(markdown).getMarkdown()

describe('an image', () => {
  it.each([
    ['as Markdown', '![captura](/api/attachments/x.png)'],
    ['as Markdown, with its caption', '![captura](/api/attachments/x.png "Pie de foto")'],
    ['as a tag alone, with a width', '<img src="/api/attachments/a.png" width="600">'],
    ['as a tag in a line of text', 'Mira <img src="x.png" alt="a" height="20"> aquí'],
    ['as a tag in capitals, unquoted, closed', '<IMG SRC=x.png Width=50% />'],
    ['as a tag with single quotes and entities', "<img src='/a.png' alt=\"Logo &amp; nombre\" title=\"Dice &quot;hola&quot;\">"],
    ['as a tag in a list item', '- uno\n- <img src="/a.png" width="300">'],
    ['as a tag in a quote', '> <img src="/a.png" width="300">'],
    ['as a tag in a toggle', '<details>\n<summary>Captura</summary>\n\n<img src="/a.png" width="50%">\n\n</details>'],
    ['as a linked tag, a badge', '[<img src="/badge.svg" height="20">](https://ci.test)'],
    ['as a tag between paragraphs', 'Antes\n\n<img src="/a.png" width="50%">\n\nDespués'],
  ])('is an image, written back as it was: %s', (_name, markdown) => {
    const editor = open(markdown)
    expect(types(editor)).toContain('image')
    expect(editor.getMarkdown()).toBe(markdown)
  })

  it.each([
    ['an address that runs code', '<img src="javascript:alert(1)">'],
    ['an address with the data itself', '<img src="data:image/png;base64,iVBORw0KGgo=">'],
    ['no address', '<img alt="sin src">'],
    ['two tags in one block', '<img src="/a.png">\n<img src="/b.png">'],
    ['other HTML around it', '<p align="center"><img src="/a.png" width="300"></p>'],
  ])('stays HTML as it was with %s', (_name, markdown) => {
    const editor = open(markdown)
    expect(types(editor)).not.toContain('image')
    expect(editor.getMarkdown()).toBe(markdown)
  })

  it('is an image in a table too, the same from the first save on', () => {
    const once = roundTrip('| Logo |\n| --- |\n| <img src="/a.png" width="40"> |')
    expect(once).toContain('<img src="/a.png" width="40">')
    expect(types(open(once))).toContain('image')
    expect(roundTrip(once)).toBe(once)
  })

  it('reads the size and the caption of a tag', () => {
    const editor = open('<img src="/a.png" alt="Logo" title="Pie" width="50%" height="80">')
    expect(editor.state.doc.nodeAt(first(editor))!.attrs).toMatchObject({ src: '/a.png', alt: 'Logo', title: 'Pie', width: '50%', height: '80' })
  })
})

describe('an image changed in the editor', () => {
  it('is written as the tag GitHub sizes once it has a width, and as Markdown again without one', () => {
    const editor = open('![captura](/a.png "Pie")')
    setImageWidth(editor, first(editor), '50%')
    expect(saved(editor)).toBe('<img src="/a.png" alt="captura" title="Pie" width="50%">')
    expect(roundTrip(saved(editor))).toBe(saved(editor))
    setImageWidth(editor, first(editor), null)
    expect(saved(editor)).toBe('![captura](/a.png "Pie")')
  })

  it('changes only what changed in a tag it was read from, and drops a height that would stretch it', () => {
    const editor = open('<img width="600" src="/a.png" height="400" data-x=\'1\'>')
    setImageWidth(editor, first(editor), '50%')
    expect(saved(editor)).toBe('<img width="50%" src="/a.png" data-x=\'1\'>')
    setImageCaption(editor, first(editor), 'Un pie')
    expect(saved(editor)).toBe('<img width="50%" src="/a.png" data-x=\'1\' title="Un pie">')
    setImageCaption(editor, first(editor), '')
    expect(saved(editor)).toBe('<img width="50%" src="/a.png" data-x=\'1\'>')
  })

  it('takes a caption as its title, quotes and all, and none once it is empty', () => {
    const editor = open('![a](/x.png)')
    setImageCaption(editor, first(editor), '  Dice  "hola" ')
    expect(saved(editor)).toBe('![a](/x.png "Dice \\"hola\\"")')
    expect(open(saved(editor)).state.doc.nodeAt(first(open(saved(editor))))!.attrs.title).toBe('Dice "hola"')
    setImageCaption(editor, first(editor), ' ')
    expect(saved(editor)).toBe('![a](/x.png)')
  })

  it('escapes what its tag holds, and reads it back the same', () => {
    const editor = open('')
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: '/a b.png', alt: 'Logo "A" & <B>' } }] }] })
    setImageWidth(editor, first(editor), '25%')
    expect(saved(editor)).toBe('<img src="/a b.png" alt="Logo &quot;A&quot; &amp; &lt;B&gt;" width="25%">')
    const again = open(saved(editor))
    expect(again.state.doc.nodeAt(first(again))!.attrs).toMatchObject({ src: '/a b.png', alt: 'Logo "A" & <B>', width: '25%' })
  })

  it('keeps its link, as a badge, and its list, with a width', () => {
    const badge = open('[![build](/b.svg)](https://ci.test)')
    setImageWidth(badge, first(badge), '25%')
    expect(saved(badge)).toBe('[<img src="/b.svg" alt="build" width="25%">](https://ci.test)')
    expect(roundTrip(saved(badge))).toBe(saved(badge))
    const list = open('- uno\n- ![a](/a.png)')
    setImageWidth(list, first(list), '50%')
    expect(saved(list)).toBe('- uno\n- <img src="/a.png" alt="a" width="50%">')
    const again = open(saved(list))
    expect(again.getJSON().content?.map((node) => node.type)).toEqual(['bulletList'])
    expect(again.getMarkdown().trimEnd()).toBe(saved(list))
  })

  it('is changed as one step each time, undone on its own, and stays selected', () => {
    const editor = open('![a](/x.png)', 'markdown', true)
    const steps = undoDepth(editor.state)
    setImageWidth(editor, first(editor), '75%')
    setImageCaption(editor, first(editor), 'Pie')
    expect(undoDepth(editor.state)).toBe(steps + 2)
    expect(imageAt(editor.state)).toBe(first(editor))
    editor.commands.undo()
    expect(saved(editor)).toBe('<img src="/x.png" alt="a" width="75%">')
    editor.commands.undo()
    expect(saved(editor)).toBe('![a](/x.png)')
  })

  it('shows its caption under it, and the width it was given', () => {
    const editor = open('<img src="/x.png" title="Pie" width="40%">', 'markdown', true)
    const box = editor.view.dom.querySelector<HTMLElement>('.orq-image')!
    expect(box.style.width).toBe('40%')
    expect(box.hasAttribute('data-sized')).toBe(true)
    expect(box.querySelector('.orq-image-caption')!.textContent).toBe('Pie')
    setImageWidth(editor, first(editor), '600')
    expect(editor.view.dom.querySelector<HTMLElement>('.orq-image')!.style.width).toBe('600px')
  })
})

describe('the bar of an image', () => {
  it('is for the image selected, or alone on the line with the cursor, and no other', () => {
    const editor = open('Texto\n\n![a](/x.png)\n\nMira ![b](/y.png) aquí', 'markdown', true)
    const image = first(editor)
    editor.commands.setNodeSelection(image)
    expect(imageAt(editor.state)).toBe(image)
    editor.commands.setTextSelection(image)
    expect(imageAt(editor.state)).toBe(image)
    editor.commands.setTextSelection(2)
    expect(imageAt(editor.state)).toBeNull()
    let inLine = -1
    editor.state.doc.descendants((node, pos) => void (node.type.name === 'image' && node.attrs.alt === 'b' && (inLine = pos)))
    editor.commands.setTextSelection(inLine)
    expect(imageAt(editor.state)).toBeNull()
  })
})

describe('an image as HTML', () => {
  it('shows its caption under it in a comment, as text, and its width', () => {
    const html = markdownToHtml('![a](/x.png "Pie <b>")\n\n<img src="/y.png" width="50%">')
    expect(html).toContain('<span class="orq-image"><img src="/x.png" alt="a" title="Pie &lt;b&gt;"><span class="orq-image-caption">Pie &lt;b&gt;</span></span>')
    expect(html).toContain('<span class="orq-image" style="width: 50%" data-sized=""><img src="/y.png" width="50%"></span>')
  })

  it('comes back the same through copy and paste, also from a comment, without its caption as text', () => {
    for (const markdown of ['![a](/x.png "Pie")', '<img src="/x.png" alt="a" title="Pie" width="50%">']) {
      expect(open(open(markdown).getHTML(), 'html').getMarkdown()).toBe(markdown)
      expect(open(markdownToHtml(markdown), 'html').getMarkdown()).toBe(markdown)
    }
  })
})
