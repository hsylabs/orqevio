import { Editor } from '@tiptap/core'
import { documentExtensions } from './markdown'

/**
 * Markdown shown and never edited (a comment), as the editor would show it: read with the same
 * extensions and written out as HTML once, instead of a live editor each. What it writes comes
 * from the editor's schema only: text is escaped, raw HTML stays text, and links keep only the
 * addresses the editor allows (any other one is written without it).
 */
let reader: Editor | null = null
const cache = new Map<string, string>()
const CACHED = 500

export function markdownToHtml(markdown: string): string {
  const hit = cache.get(markdown)
  if (hit !== undefined) return hit
  reader ??= new Editor({ extensions: documentExtensions(), content: '' })
  reader.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false })
  // A task's box shows whether it is done; here it can't be ticked.
  // The empty paragraph the editor keeps after a list or a table at the end is no part of it.
  const html = reader
    .getHTML()
    .replace(/<input type="checkbox"/g, '<input type="checkbox" disabled')
    .replace(/(?:<p><\/p>)+$/, '')
  if (cache.size >= CACHED) cache.delete(cache.keys().next().value!)
  cache.set(markdown, html)
  return html
}
