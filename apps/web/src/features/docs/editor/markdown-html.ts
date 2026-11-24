import { Editor } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import i18next, { t } from 'i18next'
import { icon, languageClass, languageName } from './code-block'
import { highlightCode, loadCodeColours, whenCodeColoursLoad } from './code-languages'
import { documentExtensions } from './markdown'

/**
 * Markdown shown and never edited (a comment), as the editor would show it: read with the same
 * extensions and written out as HTML once, instead of a live editor each. What it writes comes
 * from the editor's schema only: text is escaped, raw HTML stays text, and links keep only the
 * addresses the editor allows (any other one is written as no link at all).
 */
let reader: Editor | null = null
const cache = new Map<string, string>()
const CACHED = 500

function render(markdown: string) {
  // Never given content: read through its Markdown parser, it keeps no history of what it read.
  reader ??= new Editor({ extensions: documentExtensions() })
  const doc = reader.schema.nodeFromJSON(reader.markdown!.parse(markdown))
  // Written into a document of its own, which loads nothing, and touched up as elements, never as text.
  const page = document.implementation.createHTMLDocument('')
  const root = page.createElement('div')
  root.append(DOMSerializer.fromSchema(reader.schema).serializeFragment(doc.content, { document: page }))
  for (const link of root.querySelectorAll('a[href=""]')) link.removeAttribute('href')
  for (const code of root.querySelectorAll('pre:not([data-raw-html]):not([data-raw-markdown]) > code')) codeBlock(code, page)
  // A task's box shows whether it is done; here it can't be ticked.
  for (const box of root.querySelectorAll('input[type="checkbox"]')) box.setAttribute('disabled', '')
  // The empty paragraph the editor keeps after a list or a table at the end is no part of it.
  while (root.lastElementChild?.matches('p:empty')) root.lastElementChild.remove()
  return root.innerHTML
}

/**
 * A code block as the editor shows it (code-block.ts): its code in its language's colours, and a bar
 * with the language's name and a button that copies the code (see `data-copy-code`).
 */
function codeBlock(code: Element, page: Document) {
  // The schema writes the whole info string after `language-`: read as the editor reads it.
  const info = (code.getAttribute('class') ?? '').replace(/^language-/, '')
  const className = languageClass(info)
  if (className) code.setAttribute('class', className)
  else code.removeAttribute('class')
  // Built as elements from highlight.js's tree of spans and text: the code stays text.
  const tree = highlightCode(info, code.textContent ?? '')
  type Hast = (typeof tree.children)[number]
  const build = (node: Hast): Node => {
    if (node.type === 'text') return page.createTextNode(node.value)
    if (node.type !== 'element') return page.createTextNode('')
    const span = page.createElement('span')
    const names = node.properties?.className
    if (Array.isArray(names)) span.className = names.filter((name): name is string => typeof name === 'string' && /^hljs-[\w-]+$|^[\w-]+_$/.test(name)).join(' ')
    span.append(...node.children.map((child) => build(child as Hast)))
    return span
  }
  if (tree.children.some((node) => node.type === 'element')) code.replaceChildren(...tree.children.map(build))
  const pre = code.parentElement!
  const box = page.createElement('div')
  box.className = 'orq-code'
  const name = languageName(info)
  if (!name) box.setAttribute('data-plain', '')
  const bar = page.createElement('div')
  bar.className = 'orq-code-bar'
  const shown = page.createElement('span')
  shown.className = 'orq-code-lang'
  const label = page.createElement('span')
  label.textContent = name
  shown.append(label)
  const copy = page.createElement('button')
  copy.type = 'button'
  copy.className = 'orq-code-copy'
  copy.setAttribute('data-copy-code', '')
  copy.setAttribute('aria-label', t('docs:editor.code.copy'))
  copy.title = t('docs:editor.code.copy')
  copy.append(icon('copy', 'orq-code-icon', page), icon('check', 'orq-code-icon orq-code-icon--done', page))
  bar.append(shown, copy)
  pre.replaceWith(box)
  box.append(bar, pre)
}

// What was written before the colours came, or in another language of the app, is written again.
whenCodeColoursLoad(() => cache.clear())
i18next.on('languageChanged', () => cache.clear())

export function markdownToHtml(markdown: string): string {
  void loadCodeColours()
  const hit = cache.get(markdown)
  if (hit !== undefined) return hit
  let html: string
  try {
    html = render(markdown)
  } catch {
    // Something the reader can't take shows as it was written, as text.
    const p = document.createElement('p')
    p.textContent = markdown
    html = p.outerHTML
  }
  if (cache.size >= CACHED) cache.delete(cache.keys().next().value!)
  cache.set(markdown, html)
  return html
}
