import { Editor, getHTMLFromFragment } from '@tiptap/core'
import { documentExtensions } from './markdown'

/**
 * Markdown shown and never edited (a comment), as the editor would show it: read with the same
 * extensions and written out as HTML once, instead of a live editor each. What it writes comes
 * from the editor's schema only: text is escaped, raw HTML stays text, and links keep only the
 * addresses the editor allows (any other one is written without it, as no link).
 */
let reader: Editor | null = null
const cache = new Map<string, string>()
const CACHED = 500

/** A code block's language names a class: only a first word that can be one, never the rest of the line. */
const language = (_match: string, info: string) => {
  const first = info.split(/\s+/)[0] ?? ''
  return /^[\w#+.-]+$/.test(first) ? `class="language-${first}"` : ''
}

export function markdownToHtml(markdown: string): string {
  const hit = cache.get(markdown)
  if (hit !== undefined) return hit
  // Never given content: read through its Markdown parser, it keeps no history of what it read.
  reader ??= new Editor({ extensions: documentExtensions() })
  const doc = reader.schema.nodeFromJSON(reader.markdown!.parse(markdown))
  const html = getHTMLFromFragment(doc.content, reader.schema)
    // A task's box shows whether it is done; here it can't be ticked.
    .replace(/<input type="checkbox"/g, '<input type="checkbox" disabled')
    .replace(/ href=""/g, '')
    .replace(/class="language-([^"]*)"/g, language)
    .replace(/(?:<p><\/p>)+$/, '')
  if (cache.size >= CACHED) cache.delete(cache.keys().next().value!)
  cache.set(markdown, html)
  return html
}
