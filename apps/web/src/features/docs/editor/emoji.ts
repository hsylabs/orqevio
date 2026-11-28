import { localPref, setLocalPref } from '../../../lib/theme'

/**
 * Emoji for the «/» menu's «Emoji» and the `:name:` shortcut: the character itself goes in the
 * text, which is its Markdown. Their names come from emojibase (CLDR) in the language of the app,
 * with GitHub's shortcodes in English, and are loaded the first time they are needed.
 */

export interface Emoji {
  char: string
  /** Its name in the app's language («cohete»). */
  label: string
  /** The words it is also found by, and its shortcodes, folded. */
  words: string
  /** GitHub's shortcodes: `rocket` for 🚀. */
  codes: string[]
  order: number
}

interface Compact {
  unicode: string
  hexcode: string
  label: string
  tags?: string[]
  group?: number
  order?: number
}

const LABELS: Record<string, () => Promise<{ default: Compact[] }>> = {
  en: () => import('emojibase-data/en/compact.json'),
  es: () => import('emojibase-data/es/compact.json'),
  fr: () => import('emojibase-data/fr/compact.json'),
  pt: () => import('emojibase-data/pt/compact.json'),
  it: () => import('emojibase-data/it/compact.json'),
  de: () => import('emojibase-data/de/compact.json'),
  nl: () => import('emojibase-data/nl/compact.json'),
  ja: () => import('emojibase-data/ja/compact.json'),
}

/**
 * As the search reads a name and what is typed: lowercase, without accents, and in katakana, which a
 * Japanese name may be written in or not: «ねこ» finds «ネコ». The marks of Japanese (が, ぱ) stay.
 */
export const foldWord = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u3041-\u3096]/g, (kana) => String.fromCharCode(kana.charCodeAt(0) + 0x60))

/**
 * Whether what follows a «:» is the start of an emoji's name: two letters or more, as Slack asks,
 * starting with a letter or a digit, or `+1` and `-1`. A «:» in the text then opens nothing, nor a
 * smiley typed as one: «10:30», «:-D», «:P».
 */
export const isEmojiName = (query: string) => query.length >= 2 && /^(?:[\p{L}\p{N}]|[+-]\d)/u.test(query)

/** Skin tones and hair, which only modify another emoji. */
const COMPONENTS = 2

const loaded = new Map<string, Promise<Emoji[]>>()
/** The first list loaded, in any language: what a shortcode, always in English, is looked up in. */
let ready: Emoji[] | null = null

/** The emoji with their names in `locale` (English where there are none). Loaded once per language. */
export function loadEmoji(locale: string): Promise<Emoji[]> {
  const lang = locale.split('-')[0]!.toLowerCase()
  const key = lang in LABELS ? lang : 'en'
  let list = loaded.get(key)
  if (!list) {
    list = Promise.all([LABELS[key]!(), import('emojibase-data/en/shortcodes/github.json')]).then(([{ default: data }, { default: shortcodes }]) =>
      data
        .filter((e) => e.group !== undefined && e.group !== COMPONENTS)
        .map((e) => {
          const code = (shortcodes as Record<string, string | string[]>)[e.hexcode]
          const codes = code === undefined ? [] : Array.isArray(code) ? code : [code]
          return { char: e.unicode, label: e.label, codes, order: e.order ?? 0, words: foldWord([e.label, ...(e.tags ?? []), ...codes].join(' ')) }
        })
        .sort((a, b) => a.order - b.order),
    )
    void list.then((emoji) => (ready ??= emoji), () => {})
    // Not kept if it failed: the next time tries again.
    list.catch(() => loaded.delete(key))
    loaded.set(key, list)
  }
  return list
}

/**
 * The emoji that match `query`, best first: its shortcode or its name exactly, then a name that
 * starts with it, then a shortcode or any other word that starts with it, then, for three letters or
 * more or in a language written without spaces, a word that holds it. A name, in the app's
 * language, goes before a shortcode, in English.
 */
export function searchEmoji(list: Emoji[], query: string, limit = 40): Emoji[] {
  const q = foldWord(query.trim())
  if (!q) return []
  const within = q.length >= 3 || /[^\p{ASCII}]/u.test(q)
  const rank = (e: Emoji) => {
    const label = foldWord(e.label)
    if (e.codes.includes(q) || label === q) return 0
    if (label.startsWith(q)) return 1
    if (` ${e.words}`.includes(` ${q}`)) return 2
    return within && e.words.includes(q) ? 3 : 4
  }
  return list
    .map((e) => ({ e, r: rank(e) }))
    .filter(({ r }) => r < 4)
    .sort((a, b) => a.r - b.r || a.e.order - b.e.order)
    .slice(0, limit)
    .map(({ e }) => e)
}

/** The emoji for a shortcode typed whole (`rocket` in `:rocket:`), once the emoji have been loaded. */
export const byShortcode = (code: string) => ready?.find((e) => e.codes.includes(code))?.char

/** What the «/» menu's «Emoji» offers before a name is typed: the last chosen, then the first of the list. */
export function browseEmoji(list: Emoji[], count = 40): { recent: Emoji[]; first: Emoji[] } {
  const recent = recentEmoji().flatMap((char) => list.filter((e) => e.char === char))
  return { recent, first: list.filter((e) => !recent.includes(e)).slice(0, count) }
}

/** The emoji last chosen in this browser, the latest first. */
const RECENT_KEY = 'emojiRecent'
export function recentEmoji(): string[] {
  const chars = localPref<unknown>(RECENT_KEY, [])
  return Array.isArray(chars) ? chars.filter((c): c is string => typeof c === 'string') : []
}
export const rememberEmoji = (char: string) => setLocalPref(RECENT_KEY, [char, ...recentEmoji().filter((c) => c !== char)].slice(0, 8))
