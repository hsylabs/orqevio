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

/** What a Japanese line must not start with: closing brackets and punctuation, small kana, the long vowel mark. */
const NO_LINE_START = /[、。，．,.・：；:;！？!?…‥）)」』】〕〉》〙〗］\]｝}ーゝゞヽヾ々ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ]/u
/** What a Japanese line must not end with: opening brackets. */
const NO_LINE_END = /[（(「『【〔〈《〘〖［[｛{]/u

/**
 * A phrase of a single letter, punctuation aside: BudouX finds one when it is short of context or
 * unsure ("インストール方|法", "それで|も|う|まく"). It stays with the phrase before it, and with
 * the one after it too when Japanese comes before it: after code, it is most likely a particle
 * ("<code>…</code>を|追加").
 */
const lone = (phrase) => {
  // Code (OBJECT, a symbol) counts as a letter.
  const letters = phrase.replace(/(?!\uFFFC)[\p{P}\p{S}\s]/gu, '')
  return CJK.test(letters) && [...graphemes.segment(letters)].length === 1
}

/** Where to break `text` between its phrases: offsets into it. */
export function phraseBreaks(text) {
  const phrases = splitPhrases(text)
  const breaks = []
  let offset = 0
  for (let i = 0; i < phrases.length - 1; i++) {
    offset += phrases[i].length
    const before = text[offset - 1]
    const after = text[offset]
    // A space is a place to break already.
    if (/\s/.test(before) || /\s/.test(after)) continue
    if (lone(phrases[i + 1])) continue
    if (lone(phrases[i]) && (i === 0 || CJK.test([...phrases[i - 1]].at(-1)))) continue
    if (NO_LINE_START.test(after) || NO_LINE_END.test(before)) continue
    // A number stays with what it counts ("100|万回").
    if (/\p{N}/u.test(before) && CJK.test(after)) continue
    breaks.push(offset)
  }
  return breaks
}

/** Elements whose text stays exactly as written, and which end a paragraph: the head, code blocks, scripts and drawings. */
const KEEP_BLOCK = new Set(['head', 'title', 'script', 'style', 'pre', 'svg', 'textarea'])
/** Elements whose text stays exactly as written, read as part of the sentence around them: code and commands. */
const KEEP_INLINE = new Set(['code', 'kbd', 'samp', 'var'])
/** Elements that end one paragraph and start another; any other (a, em, strong, span…) is part of the text around it. */
const BLOCKS = new Set([
  ...['html', 'body', 'header', 'main', 'footer', 'nav', 'section', 'article', 'aside', 'div', 'p', 'blockquote', 'figure', 'figcaption', 'details', 'summary'],
  ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td'],
  ...['br', 'hr', 'button', 'label', 'form', 'fieldset', 'legend'],
])
/** What BudouX reads in place of something it should not read: code kept as written, or an entity it would not know. */
const OBJECT = '\uFFFC'
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const decode = (entity) => {
  const name = entity.slice(1, -1)
  if (name[0] !== '#') return ENTITIES[name] ?? OBJECT
  const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : OBJECT
}

/**
 * The page with a <wbr> between the phrases of each Japanese paragraph. Only that changes: tags,
 * attributes and whatever is inside a kept element stay byte for byte, and removing every <wbr>
 * gives the page back as it was.
 */
export function withPhrases(html) {
  // A comment, a tag (with ">" allowed inside its quoted attributes), text, or a "<" that starts none of them.
  const tokens = html.match(/<!--[\s\S]*?-->|<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+|</g) ?? []
  /** Where to put a <wbr> in each token: offsets into it. */
  const breaks = new Map()
  /** The paragraph being read: its text, and where each of its UTF-16 units came from. */
  let text = ''
  let origin = []
  /** The kept element being skipped, and how deep inside elements of its name. */
  let keep = null

  const endParagraph = () => {
    if (CJK.test(text)) {
      for (const offset of phraseBreaks(text)) {
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
      if (KEEP_BLOCK.has(tag) || BLOCKS.has(tag)) endParagraph()
      if (KEEP_INLINE.has(tag) && opens) {
        // Read as one character; a place to break before it goes before the element.
        origin.push({ token: index, at: 0 })
        text += OBJECT
      }
      if ((KEEP_BLOCK.has(tag) || KEEP_INLINE.has(tag)) && opens) keep = { tag, depth: 1 }
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
