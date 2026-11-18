import { t } from 'i18next'

/** Words in many leaked passwords, in the app's languages: each counts as one character. */
const COMMON_WORDS = ['password', 'passw0rd', 'contrasena', 'motdepasse', 'senha', 'passwort', 'wachtwoord', 'qwerty', 'azerty', 'qwertz', 'letmein', 'welcome', 'iloveyou', 'admin', 'secret', 'orqevio']
/** Keyboard rows: four keys in a row count as one character. */
const KEYBOARD_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'azertyuiop', 'qsdfghjklm', 'wxcvbn']

/**
 * How many characters a password is worth: common words, keyboard runs, sequences (`abc`, `4321`)
 * and repeats (`aaa`) count as one each, since they are the first things an attacker tries.
 */
export function effectiveLength(password: string): number {
  // Without accents: `contraseña` is `contrasena` to an attacker's list.
  let rest = password.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  // Longest runs first, so that a whole row counts once.
  for (const row of KEYBOARD_ROWS) {
    for (const keys of [row, [...row].reverse().join('')]) {
      for (let size = keys.length; size >= 4; size--) {
        for (let at = 0; at + size <= keys.length; at++) rest = rest.replaceAll(keys.slice(at, at + size), '\u0001')
      }
    }
  }
  for (const word of COMMON_WORDS) rest = rest.replaceAll(word, '\u0001')
  const chars = [...rest]
  let length = 0
  for (let i = 0; i < chars.length; ) {
    // A run: each character the same as, or next to, the one before (`aaa`, `abc`, `321`).
    const step = (chars[i + 1]?.codePointAt(0) ?? NaN) - chars[i]!.codePointAt(0)!
    let end = i + 1
    if (Math.abs(step) <= 1) while (end < chars.length && chars[end]!.codePointAt(0)! - chars[end - 1]!.codePointAt(0)! === step) end++
    length += 1
    i = end - i >= 3 ? end : i + 1
  }
  return length
}

/** Rough estimate for user-chosen master passwords (charset × length), with practical warnings in the app's language. */
export function estimateMasterPassword(password: string): { score: 0 | 1 | 2 | 3; label: string; hint: string } {
  if (!password) return { score: 0, label: '', hint: t('vault:strength.emptyHint') }
  let pool = 0
  if (/[a-z]/.test(password)) pool += 26
  if (/[A-Z]/.test(password)) pool += 26
  if (/[0-9]/.test(password)) pool += 10
  if (/[^a-zA-Z0-9]/.test(password)) pool += 20
  const unique = new Set(password).size
  const bits = Math.log2(Math.max(pool, 2)) * Math.min(effectiveLength(password), unique * 2)
  if (password.length < 12) return { score: 0, label: t('vault:strength.tooShort'), hint: t('vault:strength.tooShortHint') }
  if (bits < 60) return { score: 1, label: t('vault:strength.fair'), hint: t('vault:strength.fairHint') }
  if (bits < 85) return { score: 2, label: t('vault:strength.good'), hint: t('vault:strength.rememberHint') }
  return { score: 3, label: t('vault:strength.veryGood'), hint: t('vault:strength.rememberHint') }
}
