/**
 * The languages Orqevio speaks. English is the default and the reference every
 * translation is checked against.
 */
export const LOCALES = ['en', 'es', 'fr', 'pt', 'it', 'de', 'nl', 'ja'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'

/** Each language's own name, as a language picker shows it. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  pt: 'Português',
  it: 'Italiano',
  de: 'Deutsch',
  nl: 'Nederlands',
  ja: '日本語',
}

export const isLocale = (value: unknown): value is Locale => typeof value === 'string' && (LOCALES as readonly string[]).includes(value)

/** The first of `tags` (BCP 47, in order of preference) that `available` covers; null if none does. */
export function matchLocale<T extends string>(tags: readonly string[], available: readonly T[]): T | null {
  for (const tag of tags) {
    const base = tag.trim().toLowerCase().split(/[-_]/)[0]
    const found = available.find((locale) => locale === base)
    if (found) return found
  }
  return null
}

/** What Orqevio creates on someone's behalf, in their language. */
export const DEFAULT_COLUMNS: Record<Locale, readonly string[]> = {
  en: ['To do', 'In progress', 'Done'],
  es: ['Por hacer', 'En curso', 'Hecho'],
  fr: ['À faire', 'En cours', 'Terminé'],
  pt: ['A fazer', 'Em andamento', 'Concluído'],
  it: ['Da fare', 'In corso', 'Fatto'],
  de: ['Offen', 'In Arbeit', 'Erledigt'],
  nl: ['Te doen', 'Bezig', 'Klaar'],
  ja: ['未着手', '進行中', '完了'],
}

const WORKSPACE_NAMES: Record<Locale, string> = {
  en: '{name}’s workspace',
  es: 'Espacio de {name}',
  fr: 'Espace de {name}',
  pt: 'Espaço de {name}',
  it: 'Spazio di {name}',
  de: 'Arbeitsbereich von {name}',
  nl: 'Werkruimte van {name}',
  ja: '{name}のワークスペース',
}

/** The first workspace of a copy, named after its owner's first name. */
export function defaultWorkspaceName(locale: Locale, firstName: string) {
  // French elides "de" before a vowel: "Espace d’Anne". Names starting with h vary, so they keep "de".
  const template = locale === 'fr' && /^[aeiouyàâäæéèêëîïôöœùûü]/i.test(firstName) ? 'Espace d’{name}' : WORKSPACE_NAMES[locale]
  return template.replace('{name}', firstName)
}
