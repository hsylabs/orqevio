import type { Theme } from '@orqevio/shared'

const KEY = 'orqevio.theme'

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
  try {
    if (theme === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, theme)
  } catch {
    // Storage may be unavailable (private mode); the theme still applies for this session.
  }
}

export function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

export function localPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`orqevio.${key}`)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function setLocalPref(key: string, value: unknown) {
  try {
    localStorage.setItem(`orqevio.${key}`, JSON.stringify(value))
  } catch {
    // Ignore: preferences are a convenience only.
  }
}
