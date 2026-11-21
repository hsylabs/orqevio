import { Editor } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
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

/** A code block's language names a class: only a first word that can be one, never the rest of its line. */
const LANGUAGE = /^[\w#+.-]+$/

function render(markdown: string) {
  // Never given content: read through its Markdown parser, it keeps no history of what it read.
  reader ??= new Editor({ extensions: documentExtensions() })
  const doc = reader.schema.nodeFromJSON(reader.markdown!.parse(markdown))
  // Written into a document of its own, which loads nothing, and touched up as elements, never as text.
  const page = document.implementation.createHTMLDocument('')
  const root = page.createElement('div')
  root.append(DOMSerializer.fromSchema(reader.schema).serializeFragment(doc.content, { document: page }))
  for (const link of root.querySelectorAll('a[href=""]')) link.removeAttribute('href')
  for (const code of root.querySelectorAll('pre > code[class]')) {
    const language = (code.getAttribute('class') ?? '').replace(/^language-/, '').split(/\s+/)[0] ?? ''
    if (LANGUAGE.test(language)) code.setAttribute('class', `language-${language}`)
    else code.removeAttribute('class')
  }
  // A task's box shows whether it is done; here it can't be ticked.
  for (const box of root.querySelectorAll('input[type="checkbox"]')) box.setAttribute('disabled', '')
  // The empty paragraph the editor keeps after a list or a table at the end is no part of it.
  while (root.lastElementChild?.matches('p:empty')) root.lastElementChild.remove()
  return root.innerHTML
}

export function markdownToHtml(markdown: string): string {
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
