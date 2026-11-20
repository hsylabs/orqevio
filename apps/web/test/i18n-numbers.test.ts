import i18next from 'i18next'
import { describe, expect, it } from 'vitest'
import { numbersAsWritten } from '../src/i18n'

const texts = { items_one: '{{count}} item', items_other: '{{count}} items', size: 'Up to {{max}} and {{name}}', named: '{{n, number}}' }

async function instance(lng: string) {
  const i18n = i18next.createInstance()
  await i18n.init({ lng, resources: { [lng]: { translation: texts } }, interpolation: { escapeValue: false, alwaysFormat: true } })
  numbersAsWritten(i18n)
  return i18n
}

describe('numbers in texts', () => {
  it('are written as the language writes them, and plurals still follow the number', async () => {
    const en = await instance('en')
    expect(en.t('items', { count: 5000 })).toBe('5,000 items')
    expect(en.t('items', { count: 1 })).toBe('1 item')
    expect(en.t('size', { max: 200000, name: 'Ana' })).toBe('Up to 200,000 and Ana')
    expect((await instance('de')).t('items', { count: 5000 })).toBe('5.000 items')
    expect((await instance('fr')).t('items', { count: 12345 })).toBe('12\u202f345 items')
    // Spanish groups from five digits on.
    const es = await instance('es')
    expect(es.t('items', { count: 5000 })).toBe('5000 items')
    expect(es.t('items', { count: 12345 })).toBe('12.345 items')
    // A text naming its format keeps it.
    expect(en.t('named', { n: 1234.5 })).toBe('1,234.5')
  })
})
