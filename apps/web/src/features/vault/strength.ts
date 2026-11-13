import { t } from 'i18next'

/** Rough estimate for user-chosen master passwords (charset × length), with practical warnings in the app's language. */
export function estimateMasterPassword(password: string): { score: 0 | 1 | 2 | 3; label: string; hint: string } {
  if (!password) return { score: 0, label: '', hint: t('vault:strength.emptyHint') }
  let pool = 0
  if (/[a-z]/.test(password)) pool += 26
  if (/[A-Z]/.test(password)) pool += 26
  if (/[0-9]/.test(password)) pool += 10
  if (/[^a-zA-Z0-9]/.test(password)) pool += 20
  const unique = new Set(password).size
  const bits = Math.log2(Math.max(pool, 2)) * Math.min(password.length, unique * 2)
  if (password.length < 12) return { score: 0, label: t('vault:strength.tooShort'), hint: t('vault:strength.tooShortHint') }
  if (bits < 60) return { score: 1, label: t('vault:strength.fair'), hint: t('vault:strength.fairHint') }
  if (bits < 85) return { score: 2, label: t('vault:strength.good'), hint: t('vault:strength.rememberHint') }
  return { score: 3, label: t('vault:strength.veryGood'), hint: t('vault:strength.rememberHint') }
}
