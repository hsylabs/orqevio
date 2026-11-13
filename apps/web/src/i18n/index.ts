import { DEFAULT_LOCALE, LOCALES, type Locale, isLocale, matchLocale } from '@orqevio/shared'
import i18n, { type BackendModule, type ResourceKey } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { NAMESPACES, en } from './resources'

/** Every language but English is loaded on demand, as one small chunk per catalog. */
const catalogs = import.meta.glob<ResourceKey>(['./locales/*/*.json', '!./locales/en/*.json'], { import: 'default' })

/** The languages this build has catalogs for. */
export const AVAILABLE_LOCALES: readonly Locale[] = LOCALES.filter(
  (locale) => locale === DEFAULT_LOCALE || Object.keys(catalogs).some((path) => path.startsWith(`./locales/${locale}/`)),
)

const isAvailable = (value: unknown): value is Locale => isLocale(value) && AVAILABLE_LOCALES.includes(value)

/** The last language shown on this device, for the screens before signing in. */
const STORAGE_KEY = 'orqevio.locale'

function storedLocale() {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return isAvailable(value) ? value : null
  } catch {
    return null
  }
}

/** This device's last language, else the browser's first available one, else English. */
export function detectLocale(): Locale {
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language]
  return storedLocale() ?? matchLocale(preferred, AVAILABLE_LOCALES) ?? DEFAULT_LOCALE
}

const lazyCatalogs: BackendModule = {
  type: 'backend',
  init() {},
  read(language, namespace, callback) {
    const load = catalogs[`./locales/${language}/${namespace}.json`]
    if (!load) return callback(new Error(`No "${namespace}" catalog for "${language}"`), false)
    load().then(
      (resources) => callback(null, resources),
      (error: Error) => callback(error, false),
    )
  },
}

/** Loads the detected language before the first render, so text never flashes in another one. */
export async function setupI18n() {
  i18n.on('languageChanged', (language) => {
    document.documentElement.lang = language
  })
  await i18n
    .use(lazyCatalogs)
    .use(initReactI18next)
    .init({
      lng: detectLocale(),
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: [...AVAILABLE_LOCALES],
      load: 'currentOnly',
      ns: NAMESPACES,
      defaultNS: 'common',
      resources: { en },
      partialBundledLanguages: true,
      // React already escapes what it renders.
      interpolation: { escapeValue: false },
      // Catalogs are loaded before a language is shown, so nothing needs to suspend.
      react: { useSuspense: false },
    })
}

/** The language the app is showing now. */
export const currentLocale = (): Locale => (isLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LOCALE)

/** Shows the app in `locale` and remembers it on this device; ignores languages this build lacks. */
export async function applyLocale(locale: string) {
  if (!isAvailable(locale)) return
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // Storage may be unavailable (private mode); the language still applies for this session.
  }
  if (i18n.resolvedLanguage !== locale) await i18n.changeLanguage(locale)
}
