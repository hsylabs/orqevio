// @vitest-environment jsdom
import { Editor, type JSONContent } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { type Emoji, browseEmoji, byShortcode, foldWord, isEmojiName, loadEmoji, rememberEmoji, searchEmoji } from '../src/features/docs/editor/emoji'
import { EmojiCommands, EmojiShortcodes, emojiKey } from '../src/features/docs/editor/extensions'
import { documentExtensions } from '../src/features/docs/editor/markdown'
import { createSuggestionStore } from '../src/features/docs/editor/suggestion-store'

// The emoji of the «:» menu, found by their names in the app's language and by GitHub's shortcodes.
let es: Emoji[]
let en: Emoji[]
let ja: Emoji[]
beforeAll(async () => {
  ;[es, en, ja] = await Promise.all([loadEmoji('es-ES'), loadEmoji('en'), loadEmoji('ja')])
})

const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))

/** An editor with the «:» menu and the shortcodes, the cursor at the end of what it holds. */
function open(content: string | JSONContent = '') {
  const editor = new Editor({
    extensions: [
      ...documentExtensions(),
      EmojiCommands.configure({ store: createSuggestionStore(), items: () => [], starts: (query) => isEmojiName(query) }),
      EmojiShortcodes.configure({ find: byShortcode }),
    ],
    content,
    ...(typeof content === 'string' ? { contentType: 'markdown' as const } : {}),
  })
  editors.push(editor)
  editor.commands.focus('end')
  return editor
}
/** Typed key by key, as the browser sends it, so that the input rules run. */
function type(editor: Editor, text: string) {
  for (const char of text) {
    const { from, to } = editor.state.selection
    if (!editor.view.someProp('handleTextInput', (handle) => handle(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)))) editor.view.dispatch(editor.state.tr.insertText(char, from, to))
  }
}
const menuOpen = (editor: Editor) => !!emojiKey.getState(editor.state)?.active

const chars = (list: Emoji[]) => list.map((e) => e.char)

describe('the emoji list', () => {
  it('has the names in the language asked, and English for one there is no list for', async () => {
    expect(es.find((e) => e.char === '🚀')?.label).toBe('cohete')
    expect(en.find((e) => e.char === '🚀')?.label).toBe('rocket')
    expect(await loadEmoji('ko')).toBe(en)
  })

  it('is loaded once per language', async () => {
    expect(await loadEmoji('es')).toBe(es)
  })

  it('leaves out skin tones and hair, which only change another emoji', () => {
    expect(chars(es)).not.toContain('🏽')
    expect(chars(es)).toContain('👍')
  })

  it('goes in the order of the Unicode list', () => {
    expect(es[0]!.char).toBe('😀')
    expect(es.every((e, i) => i === 0 || es[i - 1]!.order <= e.order)).toBe(true)
  })
})

describe('searching', () => {
  it('finds an emoji by its name, with or without accents', () => {
    expect(chars(searchEmoji(es, 'cohete'))[0]).toBe('🚀')
    expect(chars(searchEmoji(es, 'corazon'))).toContain('❤️')
    expect(chars(searchEmoji(es, 'CORAZÓN'))).toContain('❤️')
  })

  it('finds it by its shortcode in any language, the exact one first', () => {
    expect(chars(searchEmoji(es, 'rocket'))[0]).toBe('🚀')
    expect(chars(searchEmoji(es, 'fire'))[0]).toBe('🔥')
    expect(chars(searchEmoji(es, 'tada'))[0]).toBe('🎉')
  })

  it('puts the names that start with what was typed before those that only hold it', () => {
    // «fuente», «fuego», «fuegos artificiales», in their order, and then those with another word or a
    // shortcode that starts so, as ⛽'s `fuelpump`.
    const found = searchEmoji(es, 'fue')
    expect(chars(found).slice(0, 3)).toEqual(['⛲', '🔥', '🎆'])
    expect(chars(found).indexOf('⛽')).toBeGreaterThan(2)
  })

  it('finds a word among the others of its name', () => {
    expect(chars(searchEmoji(es, 'confeti'))).toContain('🎉')
  })

  it('finds nothing for nothing, and at most as many as asked', () => {
    expect(searchEmoji(es, '  ')).toEqual([])
    expect(searchEmoji(es, 'a', 5)).toHaveLength(5)
  })

  it('finds nothing for a smiley typed as one, in any language', () => {
    for (const list of [es, en]) for (const smiley of ['DD', 'xd', 'xp', '-D', '-P']) expect(searchEmoji(list, smiley), smiley).toEqual([])
  })

  it('in Japanese, finds a name in katakana typed in hiragana, and keeps the marks that make another sound', () => {
    expect(chars(searchEmoji(ja, 'ねこ'))).toContain('🐈')
    // «パンダ», «パンケーキ», «食パン»…, not «バンザイ».
    const bread = chars(searchEmoji(ja, 'パン'))
    expect(bread[0]).toBe('🐼')
    expect(bread).toContain('🍞')
    expect(bread).not.toContain('🙌')
    expect(foldWord('が')).not.toBe(foldWord('か'))
    expect(foldWord('Canción')).toBe('cancion')
  })
})

describe('what starts the «:» menu', () => {
  it('two letters or more of a name, a digit, or +1 and -1', () => {
    for (const name of ['ro', 'cohete', '12', '+1', '-1', 'ねこ', 'DD', '火', 'ね', 'ネ']) expect(isEmojiName(name), name).toBe(true)
    for (const other of ['', 'r', 'P', 'é', '1', '-D', '-P', '-)', '))', '+', ' a']) expect(isEmojiName(other), other).toBe(false)
  })

  it('opens after a space, a bracket or at the start of a line, with a name', () => {
    const editor = open()
    type(editor, 'Uno :a')
    expect(menuOpen(editor)).toBe(false)
    type(editor, 'b')
    expect(menuOpen(editor)).toBe(true)
    type(editor, ' (:ro')
    expect(menuOpen(editor)).toBe(true)
    const start = open()
    type(start, ':fu')
    expect(menuOpen(start)).toBe(true)
  })

  it('stays closed for a «:» in the text: a time, French spacing, a smiley, within a word', () => {
    const editor = open()
    for (const text of ['Hora: 10:30', ' remarque :', ' ', ' :-D', ' :P', ' hola:fuego']) {
      type(editor, text)
      expect(menuOpen(editor), text).toBe(false)
    }
  })

  it('stays closed right after bold or code, which ends no word', () => {
    for (const mark of ['bold', 'code']) {
      const editor = open({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ver ' }, { type: 'text', text: 'index.ts', marks: [{ type: mark }] }, { type: 'text', text: ':12' }] }] })
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)))
      expect(menuOpen(editor), mark).toBe(false)
    }
  })

  it('opens after a line break, a picture or a formula, which are no text', () => {
    for (const leaf of [{ type: 'hardBreak' }, { type: 'image', attrs: { src: '/a.png', alt: 'a' } }, { type: 'inlineMath', attrs: { latex: 'x' } }]) {
      const editor = open({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Uno' }, leaf, { type: 'text', text: ':fu' }] }] })
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)))
      expect(menuOpen(editor), leaf.type).toBe(true)
    }
  })

  it('stays closed in code', () => {
    const editor = open('```\nx\n```')
    editor.commands.setTextSelection(2)
    type(editor, ' :rocket')
    expect(editor.state.selection.$from.parent.type.name).toBe('codeBlock')
    expect(menuOpen(editor)).toBe(false)
  })
})

describe('before a name is typed', () => {
  afterEach(() => localStorage.clear())

  it('lists the last ones chosen, the latest first, and then the first of the list without them', () => {
    rememberEmoji('🚀')
    rememberEmoji('🎉')
    rememberEmoji('🚀')
    const { recent, first } = browseEmoji(es, 10)
    expect(chars(recent)).toEqual(['🚀', '🎉'])
    expect(first).toHaveLength(10)
    expect(chars(first)).not.toContain('🚀')
    expect(first[0]!.char).toBe('😀')
  })

  it('keeps 8 at most, and nothing it does not know', () => {
    for (const char of ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂']) rememberEmoji(char)
    localStorage.setItem('orqevio.emojiRecent', JSON.stringify([...JSON.parse(localStorage.getItem('orqevio.emojiRecent')!), 7, 'no']))
    expect(chars(browseEmoji(es).recent)).toEqual(['🙂', '😂', '🤣', '😅', '😆', '😁', '😄', '😃'])
  })
})

describe('a shortcode typed whole', () => {
  it('turns into its emoji as the second «:» is typed', () => {
    const editor = open()
    type(editor, 'Listo :rocket: ya')
    expect(editor.getMarkdown().trim()).toBe('Listo 🚀 ya')
  })

  it('at the start of a line, after a bracket, and one after another', () => {
    const editor = open()
    type(editor, ':tada: (:fire:) :+1: :thumbsup:')
    expect(editor.getMarkdown().trim()).toBe('🎉 (🔥) 👍 👍')
  })

  it('stays as typed when it is no emoji, in a word, or in code', () => {
    const editor = open('```\n\n```')
    type(editor, 'a :rocket:')
    expect(editor.getMarkdown()).toContain('a :rocket:')
    const text = open()
    type(text, 'hora:rocket: 10:30: :nada: :Rocket:')
    expect(text.getMarkdown().trim()).toBe('hora:rocket: 10:30: :nada: :Rocket:')
  })

  it('where the «:» menu would start: after a line break, a picture or a formula too', () => {
    for (const leaf of [{ type: 'hardBreak' }, { type: 'image', attrs: { src: '/a.png', alt: 'a' } }, { type: 'inlineMath', attrs: { latex: 'x' } }]) {
      const editor = open({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Uno' }, leaf] }] })
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 5)))
      type(editor, ':tada:')
      expect(editor.state.doc.firstChild!.lastChild!.text, leaf.type).toBe('🎉')
    }
  })

  it('not right after bold or code', () => {
    const editor = open({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nota', marks: [{ type: 'bold' }] }] }] })
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)).setStoredMarks([]))
    type(editor, ':tada:')
    expect(editor.getMarkdown().trim()).toBe('**Nota**:tada:')
  })

  it('comes back with Backspace right after', () => {
    const editor = open()
    type(editor, 'Hola :wave:')
    expect(editor.getMarkdown().trim()).toBe('Hola 👋')
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
    expect(editor.getMarkdown().trim()).toBe('Hola :wave:')
  })
})
