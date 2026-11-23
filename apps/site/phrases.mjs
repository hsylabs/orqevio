// Japanese puts no spaces between words, and a browser may break its lines anywhere, even inside a
// word ("ござい|ます"). Chromium can break them between phrases itself (word-break: auto-phrase);
// Safari and Firefox can't. So the Japanese pages are built with a place to break (<wbr>) between
// their phrases, as BudouX finds them (the model Chromium's is based on, and the one the app uses),
// and site.css lets their lines break only there. Visitors download nothing for it.
import { Parser, jaModel } from 'budoux'

const parser = new Parser(jaModel)

/** Japanese letters: a paragraph with any of them is split into phrases. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/u
/** Letters and digits of scripts that put spaces between words: a place to break between two of them falls inside a word or a number ("202|6年"). */
const SPACED = /[\p{L}\p{N}]/u
const spaced = (char) => char !== undefined && SPACED.test(char) && !CJK.test(char)
/** Characters as people see them: an emoji or a letter with its accent is one, however many code points it takes. */
const graphemes = new Intl.Segmenter('ja', { granularity: 'grapheme' })

/**
 * The phrases BudouX finds in `text`, joined again where its place to break would cut a word or a
 * number written in a spaced script, or a character drawn from several code points. The same rule
 * as splitPhrases in the app (apps/web/src/components/Phrases.tsx).
 */
export function splitPhrases(text) {
  const starts = new Set(Array.from(graphemes.segment(text), (g) => g.index))
  const phrases = []
  let offset = 0
  for (const phrase of parser.parse(text)) {
    const last = phrases.at(-1)
    if (last !== undefined && (!starts.has(offset) || (spaced([...last].at(-1)) && spaced([...phrase][0])))) phrases[phrases.length - 1] = last + phrase
    else phrases.push(phrase)
    offset += phrase.length
  }
  return phrases
}

/** Elements whose text stays exactly as written: the head, code and commands, scripts and drawings. */
const KEEP = new Set(['head', 'title', 'script', 'style', 'pre', 'code', 'kbd', 'samp', 'var', 'svg', 'textarea'])
/** Elements that end one paragraph and start another; any other (a, em, strong, span…) is part of the text around it. */
const BLOCKS = new Set([
  ...['html', 'body', 'header', 'main', 'footer', 'nav', 'section', 'article', 'aside', 'div', 'p', 'blockquote', 'figure', 'figcaption', 'details', 'summary'],
  ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td'],
  ...['br', 'hr', 'button', 'label', 'form', 'fieldset', 'legend'],
])
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const decode = (entity) => {
  const name = entity.slice(1, -1)
  if (name[0] !== '#') return ENTITIES[name] ?? entity
  return String.fromCodePoint(name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10))
}

/**
 * The page with a <wbr> between the phrases of each Japanese paragraph. Only text changes: tags,
 * attributes and whatever is inside a KEEP element stay byte for byte, and removing every <wbr>
 * gives the page back as it was.
 */
export function withPhrases(html) {
  const tokens = html.match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g) ?? []
  /** Where to put a <wbr> in each text token: offsets into it. */
  const breaks = new Map()
  /** The paragraph being read: its text, and where each of its UTF-16 units came from. */
  let text = ''
  let origin = []
  /** The KEEP element being skipped, and how deep inside elements of its name. */
  let keep = null

  const endParagraph = () => {
    if (CJK.test(text)) {
      let offset = 0
      const phrases = splitPhrases(text)
      for (const phrase of phrases.slice(0, -1)) {
        offset += phrase.length
        // A space is a place to break already.
        if (/\s/.test(text[offset - 1]) || /\s/.test(text[offset])) continue
        const { token, at } = origin[offset]
        breaks.set(token, [...(breaks.get(token) ?? []), at])
      }
    }
    text = ''
    origin = []
  }

  tokens.forEach((token, index) => {
    if (token[0] === '<') {
      const [, closing, name] = /^<(\/?)([a-zA-Z][\w-]*)/.exec(token) ?? []
      if (!name) return
      const tag = name.toLowerCase()
      const opens = !closing && !token.endsWith('/>')
      if (keep) {
        if (tag === keep.tag) keep.depth += opens ? 1 : closing ? -1 : 0
        if (keep.depth === 0) keep = null
        return
      }
      if (KEEP.has(tag) || BLOCKS.has(tag)) endParagraph()
      if (KEEP.has(tag) && opens) keep = { tag, depth: 1 }
      return
    }
    if (keep) return
    for (const { 0: raw, index: at } of token.matchAll(/&(?:#x[0-9a-f]+|#\d+|[a-z]+);|[\s\S]/giu)) {
      const char = raw.length > 1 && raw[0] === '&' ? decode(raw) : raw
      for (let unit = 0; unit < char.length; unit++) origin.push({ token: index, at })
      text += char
    }
  })
  endParagraph()

  return tokens
    .map((token, index) => {
      const at = breaks.get(index)
      if (!at) return token
      let out = ''
      let from = 0
      for (const offset of at) {
        out += `${token.slice(from, offset)}<wbr>`
        from = offset
      }
      return out + token.slice(from)
    })
    .join('')
}
