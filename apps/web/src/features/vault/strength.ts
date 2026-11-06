/** Rough estimate for user-chosen master passwords (charset × length), with practical warnings. */
export function estimateMasterPassword(password: string): { score: 0 | 1 | 2 | 3; label: string; hint: string } {
  if (!password) return { score: 0, label: '', hint: 'Usa al menos 12 caracteres. Una frase de varias palabras es fácil de recordar y difícil de adivinar.' }
  let pool = 0
  if (/[a-z]/.test(password)) pool += 26
  if (/[A-Z]/.test(password)) pool += 26
  if (/[0-9]/.test(password)) pool += 10
  if (/[^a-zA-Z0-9]/.test(password)) pool += 20
  const unique = new Set(password).size
  const bits = Math.log2(Math.max(pool, 2)) * Math.min(password.length, unique * 2)
  if (password.length < 12) return { score: 0, label: 'Demasiado corta', hint: 'Necesitas al menos 12 caracteres.' }
  if (bits < 60) return { score: 1, label: 'Mejorable', hint: 'Añade más palabras o caracteres variados.' }
  if (bits < 85) return { score: 2, label: 'Buena', hint: 'Recuerda: si la olvidas, solo la clave de recuperación podrá abrir la bóveda.' }
  return { score: 3, label: 'Muy buena', hint: 'Recuerda: si la olvidas, solo la clave de recuperación podrá abrir la bóveda.' }
}
