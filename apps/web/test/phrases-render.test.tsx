import i18n from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import { Phrases } from '../src/components/Phrases'
import { loadPhrases, onPhraseParser, phraseParser } from '../src/lib/phrases'

const html = (text: string, italic?: [number, number]) => renderToStaticMarkup(<Phrases text={text} italic={italic} />)

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ lng: 'es', resources: { es: { translation: { ok: 'ok' } }, ja: { translation: { ok: 'ok' } } } })
})

describe('a sentence with a name in italics, as the greeting on Home', () => {
  it('in another language, is the sentence with the name slanted, as before', async () => {
    await i18n.changeLanguage('es')
    expect(html('Buenos días, Ana.', [13, 16])).toBe('Buenos días, <span class="italic">Ana</span>.')
    expect(html('Buenos días, Ana.')).toBe('Buenos días, Ana.')
  })

  it('in Japanese, breaks between its phrases and keeps the name slanted, even across a phrase', async () => {
    await i18n.changeLanguage('ja')
    loadPhrases()
    await new Promise<void>((done) => (phraseParser() ? done() : onPhraseParser(done)))
    const greeting = 'こんにちは、花子さん。'
    expect(html(greeting, [6, 8])).toBe('<span class="orq-phrases">こんにちは、<wbr/><span class="italic">花子</span>さん。</span>')
    // A slanted part across two phrases is slanted on both sides of the place to break.
    expect(html(greeting, [3, 8])).toBe('<span class="orq-phrases">こんに<span class="italic">ちは、</span><wbr/><span class="italic">花子</span>さん。</span>')
  })
})
