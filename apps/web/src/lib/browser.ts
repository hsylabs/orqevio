/**
 * What the vault needs from the browser, which the rest of the app does not:
 * WebCrypto (only offered on secure origins: https:// or localhost), Web Workers
 * and WebAssembly (Argon2id runs in a worker).
 */
export type VaultBlocker = 'secure_context' | 'webcrypto' | 'workers' | 'webassembly'

export function vaultBlockers(env: typeof globalThis = globalThis): VaultBlocker[] {
  // An http:// address other than localhost hides WebCrypto: say so, not that it is missing.
  if (env.isSecureContext === false) return ['secure_context']
  const missing: VaultBlocker[] = []
  if (!env.crypto?.subtle || typeof env.crypto.randomUUID !== 'function') missing.push('webcrypto')
  if (typeof env.Worker === 'undefined') missing.push('workers')
  if (typeof env.WebAssembly === 'undefined') missing.push('webassembly')
  return missing
}
