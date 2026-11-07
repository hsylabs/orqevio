/**
 * Internal references are plain Markdown links with stable, short paths so that
 * documents stay portable and readable for both humans and language models:
 *   [Card title](/card/<uuid>)   [Page title](/doc/<uuid>)
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

export const cardHref = (id: string) => `/card/${id}`
export const docHref = (id: string) => `/doc/${id}`

export function parseInternalHref(href: string): { type: 'card' | 'doc'; id: string } | null {
  const match = new RegExp(`^/(card|doc)/(${UUID})$`, 'i').exec(href.trim())
  if (!match) return null
  return { type: match[1]!.toLowerCase() as 'card' | 'doc', id: match[2]!.toLowerCase() }
}

/** Extracts the unique card and page ids referenced by Markdown links. */
export function extractReferences(markdown: string): { cards: string[]; docs: string[] } {
  const cards = new Set<string>()
  const docs = new Set<string>()
  const re = new RegExp(`\\]\\(\\s*/(card|doc)/(${UUID})\\s*(?:"[^"]*")?\\)`, 'gi')
  for (const m of markdown.matchAll(re)) {
    const id = m[2]!.toLowerCase()
    if (m[1]!.toLowerCase() === 'card') cards.add(id)
    else docs.add(id)
  }
  return { cards: [...cards], docs: [...docs] }
}

/** Rough Markdown-to-text conversion for search excerpts. */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+(\[[ xX]\]\s+)?/gm, '')
    .replace(/[*_~`|]/g, '')
    .replace(/^-{3,}$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
