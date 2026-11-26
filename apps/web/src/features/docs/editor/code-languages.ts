import { createLowlight } from 'lowlight'
import { useSyncExternalStore } from 'react'

/**
 * The languages of code blocks: the ones to choose from, the names they are shown with, and their
 * colours, from highlight.js through lowlight. A block's language is the first word of its fence's
 * info string (```ts title="a.ts"): it is shown and coloured, and the rest of the line is kept.
 */

export interface CodeLanguage {
  /** What a block chosen this way gets in its fence: GitHub and highlight.js both read it. */
  id: string
  /** As people know it; the same in every language. */
  name: string
  /** Other words for it in a fence, which also find it in the list. */
  aliases: string[]
}

const language = (id: string, name: string, aliases: string[] = []): CodeLanguage => ({ id, name, aliases })

/** The ones to choose from, by name. Each id and alias is one highlight.js colours (see code-grammars). */
export const LANGUAGES: CodeLanguage[] = [
  language('bash', 'Bash', ['sh', 'shell', 'zsh']),
  language('c', 'C', ['h']),
  language('cpp', 'C++', ['c++', 'cc', 'hpp', 'cxx', 'hxx', 'hh', 'h++']),
  language('csharp', 'C#', ['cs', 'c#']),
  language('css', 'CSS'),
  language('diff', 'Diff', ['patch']),
  language('dockerfile', 'Dockerfile', ['docker']),
  language('go', 'Go', ['golang']),
  language('graphql', 'GraphQL', ['gql']),
  language('html', 'HTML', ['xhtml']),
  language('ini', 'INI'),
  language('java', 'Java', ['jsp']),
  language('javascript', 'JavaScript', ['js', 'jsx', 'mjs', 'cjs']),
  language('json', 'JSON', ['jsonc']),
  language('kotlin', 'Kotlin', ['kt', 'kts']),
  language('less', 'Less'),
  language('lua', 'Lua'),
  language('makefile', 'Makefile', ['make', 'mk', 'mak']),
  language('markdown', 'Markdown', ['md', 'mkdown', 'mkd']),
  language('objectivec', 'Objective-C', ['objc', 'obj-c', 'mm']),
  language('perl', 'Perl', ['pl', 'pm']),
  language('php', 'PHP'),
  language('powershell', 'PowerShell', ['ps', 'ps1', 'pwsh']),
  language('python', 'Python', ['py', 'gyp', 'ipython']),
  language('r', 'R'),
  language('ruby', 'Ruby', ['rb', 'gemspec', 'podspec', 'irb']),
  language('rust', 'Rust', ['rs']),
  language('scss', 'SCSS'),
  language('sql', 'SQL'),
  language('swift', 'Swift'),
  language('toml', 'TOML'),
  language('typescript', 'TypeScript', ['ts', 'tsx', 'mts', 'cts']),
  language('xml', 'XML', ['svg', 'rss', 'atom', 'xsd', 'xsl', 'plist']),
  language('yaml', 'YAML', ['yml']),
]

/** Words that say a block is plain text: shown as such, never coloured. */
export const PLAIN = new Set(['text', 'txt', 'plaintext', 'plain'])

const byWord = new Map<string, CodeLanguage>()
for (const entry of LANGUAGES) for (const word of [entry.id, ...entry.aliases]) byWord.set(word, entry)

/** The language word of an info string: its first word, before any attributes (`js{1,3}`, `ts title="a"`). */
export function languageOf(info: string | null | undefined) {
  return /^[^\s{]+/.exec((info ?? '').trim())?.[0] ?? ''
}

/** The language an info string names, if it is one of the list. */
export function findLanguage(info: string | null | undefined) {
  return byWord.get(languageOf(info).toLowerCase())
}

/**
 * The info string with `id` as its language and the rest of it as it was. Plain text with nothing
 * else is no info string at all; with something else, it is `text`, or the rest would be read as the
 * language.
 */
export function withLanguage(info: string | null | undefined, id: string) {
  const current = (info ?? '').trim()
  // As written, from the space or the `{` after the language on.
  const rest = current.slice(languageOf(current).length)
  if (!id) return rest.trim() ? `text${rest}` : null
  return `${id}${rest}`
}

// ── Colours ──────────────────────────────────────────────────────

/** Highlight.js without any language yet: they come apart from the editor, as they weigh as much as a third of it. */
const lowlight = createLowlight()
let loaded = false
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

/** Loads the languages' colours once; whatever is shown before they arrive is redrawn with them. */
export function loadCodeColours() {
  loading ??= import('./code-grammars').then(
    ({ grammars, aliases }) => {
      lowlight.register(grammars)
      lowlight.registerAlias(aliases)
      loaded = true
      const waiting = [...listeners]
      listeners.clear()
      for (const listener of waiting) {
        try {
          listener()
        } catch (error) {
          // One editor that can't be drawn again leaves the others to be.
          console.warn('Code colours could not be drawn in an editor', error)
        }
      }
    },
    () => {
      // Offline or a new version deployed since: the code shows without colours, and a later page tries again.
      loading = null
    },
  )
  return loading
}

export const codeColoursLoaded = () => loaded

/** Calls `listener` once the colours are there, now if they already are; returns how to stop waiting. */
export function whenCodeColoursLoad(listener: () => void) {
  if (loaded) {
    listener()
    return () => {}
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const subscribe = (changed: () => void) => (loaded ? () => {} : whenCodeColoursLoad(changed))

/** Whether the colours are there, for what shows code without an editor: it draws again when they come. */
export function useCodeColours() {
  return useSyncExternalStore(subscribe, codeColoursLoaded)
}

/**
 * Beyond this, a block stays plain: the editor colours every block again as one is typed in, and a
 * log pasted whole (an agent's, say) would slow down typing in all of them.
 */
const MAX_COLOURED = 50_000

/** Whether a block with this info string is coloured: a language of highlight.js, already loaded, and not plain text. */
export function colours(info: string | null | undefined) {
  const word = languageOf(info).toLowerCase()
  return loaded && !!word && !PLAIN.has(word) && lowlight.registered(word)
}

type Root = ReturnType<typeof lowlight.highlight>
const plain = (code: string): Root => ({ type: 'root', children: [{ type: 'text', value: code }], data: { language: undefined, relevance: 0 } })

/** The tree of coloured spans of `code` in its block's language; plain when it has none or isn't loaded yet. */
export function highlightCode(info: string | null | undefined, code: string): Root {
  return colours(info) && code.length <= MAX_COLOURED ? lowlight.highlight(languageOf(info).toLowerCase(), code) : plain(code)
}

/**
 * What @tiptap/extension-code-block-lowlight is given as lowlight: the same, but it reads only the
 * first word of the info string, and never guesses the language of a block that names none, a
 * prompt or a note, which would come out coloured at random.
 */
export const highlighter = {
  highlight: (info: string, code: string) => highlightCode(info, code),
  highlightAuto: (code: string) => plain(code),
  listLanguages: () => [] as string[],
  registered: (info: string) => colours(info),
}
