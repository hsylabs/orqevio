// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { languageClass, languageName } from '../src/features/docs/editor/code-block'
import { LANGUAGES, findLanguage, highlightCode, highlighter, languageOf, loadCodeColours, withLanguage } from '../src/features/docs/editor/code-languages'
import { documentExtensions } from '../src/features/docs/editor/markdown'
import { markdownToHtml } from '../src/features/docs/editor/markdown-html'
import { followBlock } from '../src/features/docs/editor/own-step'

// A code block's language is the first word of its fence's info string: shown by its name,
// coloured by highlight.js, changed from a list, and written back with the rest of the line as it was.
const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))
beforeAll(() => loadCodeColours())

const open = (markdown: string) => {
  const editor = new Editor({ extensions: documentExtensions(), content: markdown, contentType: 'markdown' })
  editors.push(editor)
  return editor
}
const kinds = (tree: ReturnType<typeof highlightCode>) => JSON.stringify(tree).match(/hljs-[\w-]+/g) ?? []

describe('the language of a code block', () => {
  it('is the first word of the info string', () => {
    expect(languageOf('ts title="a.ts"')).toBe('ts')
    expect(languageOf('js{1,3}')).toBe('js')
    expect(languageOf('  python  ')).toBe('python')
    expect(languageOf(null)).toBe('')
  })

  it('is shown by its name, also by an alias, or as written when the list does not know it', () => {
    expect(languageName('ts')).toBe('TypeScript')
    expect(languageName('TS')).toBe('TypeScript')
    expect(languageName('yml')).toBe('YAML')
    expect(languageName('shell')).toBe('Bash')
    expect(languageName('zig')).toBe('zig')
    // Drawn rather than coloured (diagram.ts).
    expect(languageName('mermaid')).toBe('Mermaid')
    expect(languageName('')).toBe('')
    expect(findLanguage('c#')?.id).toBe('csharp')
  })

  it('is changed keeping the rest of the line as written, and plain text with nothing else is no info string', () => {
    expect(withLanguage('ts title="a.ts"', 'python')).toBe('python title="a.ts"')
    expect(withLanguage('ts   title="a.ts"', 'python')).toBe('python   title="a.ts"')
    expect(withLanguage('js{1,3}', 'python')).toBe('python{1,3}')
    expect(withLanguage(null, 'python')).toBe('python')
    expect(withLanguage('ts', '')).toBeNull()
    // The rest alone would be read as the language.
    expect(withLanguage('ts title="a.ts"', '')).toBe('text title="a.ts"')
    expect(withLanguage('js{1,3}', '')).toBe('text{1,3}')
  })

  it('names a class with its first word only, never with the rest of its line', () => {
    expect(languageClass('js fixed inset-0 z-50')).toBe('language-js')
    expect(languageClass('"><b>')).toBe('')
  })
})

describe('the colours of a code block', () => {
  it('come for every language of the list, and for each of its aliases', () => {
    for (const { id, aliases } of LANGUAGES) for (const word of [id, ...aliases]) expect(highlighter.registered(word), word).toBe(true)
  })

  it('read the first word of the info string', () => {
    expect(kinds(highlighter.highlight('ts title="a.ts"', 'const a: number = 1'))).toContain('hljs-keyword')
  })

  it('never guess the language of a block that names none, or is plain text', () => {
    const prompt = 'You are a helpful assistant. Return JSON with "name" and true or false.'
    expect(kinds(highlighter.highlightAuto(prompt))).toEqual([])
    expect(highlighter.registered('')).toBe(false)
    expect(highlighter.registered('text')).toBe(false)
    expect(highlighter.registered('mermaid')).toBe(false)
    expect(kinds(highlightCode('text', 'const a = 1'))).toEqual([])
  })

  it('stay off a block too long to colour as it is typed in', () => {
    expect(kinds(highlightCode('ts', 'const a = 1\n'.repeat(4000)))).toContain('hljs-keyword')
    expect(kinds(highlightCode('ts', 'const a = 1\n'.repeat(5000)))).toEqual([])
  })

  it('are no part of the Markdown', () => {
    const markdown = '```ts title="a.ts"\nconst a: number = 1\n```\n\n```mermaid\ngraph TD\n```\n\n```\nUn prompt\n```\n\n```text\nhola\n```\n\n```shell\nls -la\n```'
    expect(open(markdown).getMarkdown()).toBe(markdown)
  })

  it('keep a fence of tildes whose info string has a backtick', () => {
    // After backticks, such a line is no fence: the block would come back as text.
    const markdown = '~~~js `x`\nconst a = 1\n```\n~~~'
    expect(open(markdown).getMarkdown()).toBe(markdown)
    expect(open(open(markdown).getMarkdown()).state.doc.firstChild?.type.name).toBe('codeBlock')
  })
})

describe('a code block shown as HTML (a comment, a page printed)', () => {
  it('has its colours, its language and a button that copies it', () => {
    const html = markdownToHtml('```ts\nconst a = 1\n```')
    expect(html).toContain('<span class="hljs-keyword">const</span>')
    expect(html).toMatch(/<div class="orq-code"><div class="orq-code-bar"><span class="orq-code-lang"><span>TypeScript<\/span><\/span><button type="button" class="orq-code-copy" data-copy-code=""/)
    expect(html).toContain('<code class="language-ts">')
  })

  it('keeps the code text, whatever it says', () => {
    const html = markdownToHtml('```html\n<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n```')
    expect(html).not.toMatch(/<script|<img/)
    expect(html).toContain('&lt;<span class="hljs-name">script</span>&gt;')
    expect(html).toContain('<span class="hljs-attr">onerror</span>')
  })

  it('reads the language as the editor does, before any attributes', () => {
    const html = markdownToHtml('```js{1,3}\nconst a = 1\n```')
    expect(html).toContain('<span>JavaScript</span>')
    expect(html).toContain('<code class="language-js">')
    expect(html).toContain('<span class="hljs-keyword">const</span>')
  })

  it('shows a language it does not know as written, and no name for one without', () => {
    expect(markdownToHtml('```zig\nconst x = 1;\n```')).toContain('<span>zig</span>')
    const plain = markdownToHtml('```\nUn prompt\n```')
    expect(plain).toContain('<div class="orq-code" data-plain="">')
    expect(plain).toContain('<code>Un prompt</code>')
  })

  it('leaves HTML and Markdown kept as their source as they were', () => {
    const html = markdownToHtml('<div>\nhola\n</div>')
    expect(html).toContain('<pre data-raw-html="" class="orq-raw-html">')
    expect(html).not.toContain('orq-code')
  })
})

describe('a code block followed through a change', () => {
  it('is found after its language changes, which maps its start as deleted', () => {
    const editor = open('Antes\n\n```ts\nconst a = 1\n```')
    let pos = -1
    editor.state.doc.forEach((node, offset) => node.type.name === 'codeBlock' && (pos = offset))
    const tr = editor.state.tr.setNodeMarkup(pos, undefined, { language: 'python' })
    expect(tr.mapping.mapResult(pos, 1).deleted).toBe(true)
    expect(followBlock({ mapping: tr.mapping, doc: tr.doc }, pos)).toBe(pos)
    const gone = editor.state.tr.delete(pos, pos + editor.state.doc.nodeAt(pos)!.nodeSize)
    expect(followBlock({ mapping: gone.mapping, doc: gone.doc }, pos)).toBeNull()
  })

  it('is not taken for the block around a leaf that went', () => {
    const editor = open('> uno\n>\n> ---\n>\n> dos')
    let rule = -1
    editor.state.doc.descendants((node, offset) => {
      if (node.type.name === 'horizontalRule') rule = offset
    })
    expect(rule).toBeGreaterThan(0)
    const tr = editor.state.tr.delete(rule, rule + 1)
    expect(followBlock({ mapping: tr.mapping, doc: tr.doc }, rule)).toBeNull()
  })
})
