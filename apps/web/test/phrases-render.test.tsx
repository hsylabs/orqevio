import { readFileSync, readdirSync } from 'node:fs'
import i18n from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { Trans, initReactI18next } from 'react-i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import { Phrases, withoutMarks } from '../src/components/Phrases'
import { loadPhrases, onPhraseParser, phraseParser } from '../src/lib/phrases'

const html = (text: string, italic?: [number, number]) => renderToStaticMarkup(<Phrases text={text} italic={italic} />)

const LOCALES = new URL('../src/i18n/locales/', import.meta.url)
const languages = readdirSync(LOCALES)
const tags = (markup: string) => markup.replace(/<[^>]+>/g, '')
/** BudouX, loaded. */
async function budoux() {
  loadPhrases()
  await new Promise<void>((done) => (phraseParser() ? done() : onPhraseParser(done)))
}

beforeAll(async () => {
  await i18n.use(initReactI18next).init({ lng: 'es', resources: { es: { translation: { ok: 'ok' } }, ja: { translation: { ok: 'ok' } } } })
  for (const language of languages) i18n.addResourceBundle(language, 'home', JSON.parse(readFileSync(new URL(`${language}/home.json`, LOCALES), 'utf8')))
})

describe('a sentence with a name in italics, as the greeting on Home', () => {
  it('in another language, is the sentence with the name slanted, as before', async () => {
    await i18n.changeLanguage('es')
    expect(html('Buenos días, Ana.', [13, 16])).toBe('Buenos días, <span class="italic">Ana</span>.')
    expect(html('Buenos días, Ana.')).toBe('Buenos días, Ana.')
  })

  it('in Japanese, breaks between its phrases and keeps the name slanted, even across a phrase', async () => {
    await i18n.changeLanguage('ja')
    await budoux()
    const greeting = 'こんにちは、花子さん。'
    expect(html(greeting, [6, 8])).toBe('<span class="orq-phrases">こんにちは、<wbr/><span class="italic">花子</span>さん。</span>')
    // A slanted part across two phrases is slanted on both sides of the place to break.
    expect(html(greeting, [3, 8])).toBe('<span class="orq-phrases">こんに<span class="italic">ちは、</span><wbr/><span class="italic">花子</span>さん。</span>')
  })

  // The greeting on Home, in each language the app has, as it was written with Trans.
  it.each(languages)('greets in %s as before, the name in italics', async (language) => {
    await i18n.changeLanguage(language)
    if (language === 'ja') await budoux()
    const t = i18n.getFixedT(language, 'home')
    const values = { greeting: t('greeting.morning'), name: 'Ana' }
    const before = renderToStaticMarkup(<Trans t={t} i18nKey="greeting" values={values} components={{ name: <span className="italic" /> }} />)
    const [sentence, name] = withoutMarks(t('greeting', values))
    expect(name).toBeDefined()
    const now = renderToStaticMarkup(<Phrases text={sentence} italic={name} />)
    if (language === 'ja') {
      // Broken between its phrases, with the same words and the same name slanted.
      expect(tags(now)).toBe(tags(before))
      expect(now).toContain('<span class="italic">Ana</span>')
      expect(now).toContain('<wbr/>')
    } else expect(now).toBe(before)
  })

  it('takes the marks out of a sentence, and leaves one without them as it is', () => {
    expect(withoutMarks('Hola, <name>Ana</name>.')).toEqual(['Hola, Ana.', [6, 9]])
    expect(withoutMarks('Hola, <name></name>.')).toEqual(['Hola, .', [6, 6]])
    expect(withoutMarks('Hola.')).toEqual(['Hola.', undefined])
    expect(withoutMarks('Hola, <name>Ana.')).toEqual(['Hola, <name>Ana.', undefined])
    // A name that looks like the mark is still the name.
    expect(withoutMarks('Hola, <name></name></name>.')).toEqual(['Hola, </name>.', [6, 13]])
  })
})
