// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { type Emoji, browseEmoji, byShortcode, loadEmoji, rememberEmoji, searchEmoji } from '../src/features/docs/editor/emoji'
import { EmojiShortcodes } from '../src/features/docs/editor/extensions'
import { documentExtensions } from '../src/features/docs/editor/markdown'

// The emoji of the «:» menu, found by their names in the app's language and by GitHub's shortcodes.
let es: Emoji[]
let en: Emoji[]
beforeAll(async () => {
  ;[es, en] = await Promise.all([loadEmoji('es-ES'), loadEmoji('en')])
})

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
  const editors: Editor[] = []
  afterEach(() => editors.splice(0).forEach((e) => e.destroy()))

  const open = (markdown = '') => {
    const editor = new Editor({ extensions: [...documentExtensions(), EmojiShortcodes.configure({ find: byShortcode })], content: markdown, contentType: 'markdown' })
    editors.push(editor)
    editor.commands.focus('end')
    return editor
  }
  /** Typed key by key, as the browser sends it, so that the input rules run. */
  const type = (editor: Editor, text: string) => {
    for (const char of text) {
      const { from, to } = editor.state.selection
      if (!editor.view.someProp('handleTextInput', (handle) => handle(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)))) editor.view.dispatch(editor.state.tr.insertText(char, from, to))
    }
  }

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

  it('comes back with Backspace right after', () => {
    const editor = open()
    type(editor, 'Hola :wave:')
    expect(editor.getMarkdown().trim()).toBe('Hola 👋')
    editor.commands.undoInputRule()
    expect(editor.getMarkdown().trim()).toBe('Hola :wave:')
  })
})
