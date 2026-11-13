import { describe, expect, it } from 'vitest'
import { DEFAULT_COLUMNS, LOCALES, LOCALE_NAMES, defaultWorkspaceName, isLocale, matchLocale } from '../src/locales'

describe('locales', () => {
  it('matches browser language tags to the closest available language', () => {
    expect(matchLocale(['es-ES', 'en'], LOCALES)).toBe('es')
    expect(matchLocale(['pt-BR'], LOCALES)).toBe('pt')
    expect(matchLocale(['zh-CN', 'ja-JP'], LOCALES)).toBe('ja')
    expect(matchLocale(['ZH_tw'], LOCALES)).toBeNull()
    expect(matchLocale(['fr-CA'], ['en', 'es'])).toBeNull()
  })

  it('recognises only the languages Orqevio speaks', () => {
    expect(LOCALES.every(isLocale)).toBe(true)
    expect([isLocale('xx'), isLocale('es-ES'), isLocale(undefined)]).toEqual([false, false, false])
  })

  it('names what it creates in every language', () => {
    for (const locale of LOCALES) {
      expect(LOCALE_NAMES[locale]).toBeTruthy()
      expect(DEFAULT_COLUMNS[locale]).toHaveLength(3)
      expect(defaultWorkspaceName(locale, 'Ana')).toContain('Ana')
    }
    expect(defaultWorkspaceName('es', 'Ana')).toBe('Espacio de Ana')
    expect([defaultWorkspaceName('fr', 'Anne'), defaultWorkspaceName('fr', 'Élise'), defaultWorkspaceName('fr', 'Marc')]).toEqual(['Espace d’Anne', 'Espace d’Élise', 'Espace de Marc'])
  })
})
