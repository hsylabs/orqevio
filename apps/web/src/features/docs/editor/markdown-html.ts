import { Editor } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import i18next, { t } from 'i18next'
import { CALLOUT_ICONS, calloutName, calloutType } from './callout'
import { languageClass, languageName } from './code-block'
import { cssSize } from './image'
import { highlightCode, loadCodeColours, whenCodeColoursLoad } from './code-languages'
import { isDiagram } from './diagram'
import { drawMath } from './math'
import { documentExtensions, onlyDefinitions } from './markdown'
import { icon } from './svg-icons'

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
  // The definitions of links to references show nothing, as on GitHub: their links show where they go.
  for (const source of root.querySelectorAll('pre[data-raw-markdown]')) if (onlyDefinitions(source.textContent ?? '')) source.remove()
  for (const code of root.querySelectorAll('pre:not([data-raw-html]):not([data-raw-markdown]) > code')) codeBlock(code, page)
  for (const quote of root.querySelectorAll('blockquote[data-callout]')) calloutTitle(quote, page)
  for (const img of root.querySelectorAll('img[title], img[width], img[height]')) imageCaption(img, page)
  for (const formula of root.querySelectorAll<HTMLElement>('[data-type="inline-math"], [data-type="block-math"]')) mathShown(formula)
  // A toggle whose title is a heading has it in its summary, as GitHub shows it (the level, 1 to 6, is the schema's).
  for (const summary of root.querySelectorAll('details[data-level] > summary')) {
    const heading = page.createElement(`h${summary.parentElement!.getAttribute('data-level')}`)
    heading.append(...summary.childNodes)
    summary.append(heading)
  }
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
  // A diagram: drawn in its place once shown, by drawDiagrams (diagram.ts); its code stays to be copied.
  if (isDiagram(info)) {
    box.setAttribute('data-diagram', '')
    const drawing = page.createElement('div')
    drawing.className = 'orq-diagram'
    box.append(drawing)
  }
}

/**
 * An image with a caption or a width as the editor shows it (image.ts): as wide as it was made, and
 * its title under it. The image keeps both, so that a copy of it pastes the same.
 */
function imageCaption(img: Element, page: Document) {
  const box = page.createElement('span')
  box.className = 'orq-image'
  const width = cssSize(img.getAttribute('width'))
  const height = cssSize(img.getAttribute('height'))
  if (width) {
    box.setAttribute('style', `width: ${width}`)
    box.setAttribute('data-sized', '')
  } else if (height) {
    // Only a height, as a badge has: the picture that high, as wide as that makes it.
    img.setAttribute('style', `height: ${height}`)
  }
  img.replaceWith(box)
  box.append(img)
  const title = img.getAttribute('title')
  if (title) {
    const caption = page.createElement('span')
    caption.className = 'orq-image-caption'
    caption.textContent = title
    box.append(caption)
  }
}

/** A formula drawn as the editor draws it (math.ts): by KaTeX, or its source if KaTeX can't. */
function mathShown(formula: HTMLElement) {
  const display = formula.getAttribute('data-type') === 'block-math'
  formula.className = display ? 'orq-math orq-math--block' : 'orq-math'
  drawMath(formula, formula.getAttribute('data-latex') ?? '', display)
}

/** A callout's icon and its type's name on top, as the editor shows them (callout.ts). */
function calloutTitle(quote: Element, page: Document) {
  const type = calloutType(`[!${quote.getAttribute('data-callout') ?? ''}]`)
  const title = page.createElement('div')
  title.className = 'orq-callout-title'
  const name = page.createElement('span')
  name.className = 'orq-callout-type'
  const label = page.createElement('span')
  label.textContent = calloutName(type)
  name.append(icon(CALLOUT_ICONS[type], 'orq-callout-icon', page), label)
  title.append(name)
  quote.prepend(title)
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
