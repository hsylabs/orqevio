import type { KdfParams, VaultKeysInput, VaultStateDTO } from '@orqevio/shared'
import type { VaultItem } from './types'

/**
 * Client-side vault cryptography.
 *
 *  master password ──Argon2id(salt)──▶ KEK ─┐
 *                                            ├─ AES-256-GCM wraps the random 256-bit vault key
 *  recovery key ─────HKDF-SHA256────▶ RKEK ─┘
 *  vault key ── AES-256-GCM(aad = user + item id) ──▶ item envelopes
 *
 * The server only stores KDF parameters and envelopes ("v1.<iv>.<ciphertext>").
 */

const enc = new TextEncoder()
const dec = new TextDecoder()

export const DEFAULT_KDF = { algorithm: 'argon2id', memoryKiB: 65_536, iterations: 3, parallelism: 1 } as const

export class WrongSecretError extends Error {}

export function toB64u(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64u(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4)
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n))

// ── Key derivation ──────────────────────────────────────────────
async function argon2(password: string, kdf: Omit<KdfParams, 'algorithm' | 'salt'>, salt: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const request = { password, salt, memoryKiB: kdf.memoryKiB, iterations: kdf.iterations, parallelism: kdf.parallelism }
  if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
    const worker = new Worker(new URL('./kdf.worker.ts', import.meta.url), { type: 'module' })
    try {
      return await new Promise((resolve, reject) => {
        worker.onmessage = (e: MessageEvent<{ ok: boolean; hash?: Uint8Array<ArrayBuffer>; error?: string }>) =>
          e.data.ok && e.data.hash ? resolve(e.data.hash) : reject(new Error(e.data.error ?? 'KDF failed'))
        worker.onerror = (e) => reject(new Error(e.message))
        worker.postMessage(request)
      })
    } finally {
      worker.terminate()
    }
  }
  const { argon2id } = await import('hash-wasm')
  return (await argon2id({ ...request, memorySize: request.memoryKiB, hashLength: 32, outputType: 'binary' })) as Uint8Array<ArrayBuffer>
}

const importAes = (raw: Uint8Array<ArrayBuffer>) => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])

async function passwordKek(password: string, kdf: KdfParams) {
  const raw = await argon2(password.normalize('NFKC'), kdf, fromB64u(kdf.salt))
  try {
    return await importAes(raw)
  } finally {
    raw.fill(0)
  }
}

async function recoveryKek(recovery: Uint8Array<ArrayBuffer>, userId: string) {
  const base = await crypto.subtle.importKey('raw', recovery, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('orqevio/recovery/v1'), info: enc.encode(userId) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// ── Envelopes ───────────────────────────────────────────────────
async function seal(key: CryptoKey, plaintext: Uint8Array<ArrayBuffer>, aad: string): Promise<string> {
  const iv = randomBytes(12)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, plaintext))
  return `v1.${toB64u(iv)}.${toB64u(ct)}`
}

async function open(key: CryptoKey, envelope: string, aad: string): Promise<Uint8Array<ArrayBuffer>> {
  const [version, iv, ct] = envelope.split('.')
  if (version !== 'v1' || !iv || !ct) throw new Error('Unsupported envelope')
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64u(iv), additionalData: enc.encode(aad) }, key, fromB64u(ct)))
  } catch {
    throw new WrongSecretError('Decryption failed')
  }
}

const keyAad = (userId: string) => `orqevio/vault-key/v1/${userId}`
const recoveryAad = (userId: string) => `orqevio/vault-recovery/v1/${userId}`
const itemAad = (userId: string, itemId: string) => `orqevio/item/v1/${userId}/${itemId}`

// ── Recovery key (160 bits, Crockford base32) ───────────────────
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function formatRecoveryKey(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out.match(/.{1,4}/g)!.join('-')
}

export function parseRecoveryKey(input: string): Uint8Array<ArrayBuffer> | null {
  const clean = input.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (clean.length !== 32) return null
  const out = new Uint8Array(20)
  let bits = 0
  let value = 0
  let index = 0
  for (const char of clean) {
    const v = ALPHABET.indexOf(char)
    if (v < 0) return null
    value = (value << 5) | v
    bits += 5
    if (bits >= 8) {
      out[index++] = (value >>> (bits - 8)) & 255
      bits -= 8
    }
  }
  return out
}

// ── Public operations ───────────────────────────────────────────
async function wrapWithPassword(rawVaultKey: Uint8Array<ArrayBuffer>, password: string, userId: string) {
  const kdf: KdfParams = { ...DEFAULT_KDF, salt: toB64u(randomBytes(16)) }
  const kek = await passwordKek(password, kdf)
  return { kdf, wrappedKey: await seal(kek, rawVaultKey, keyAad(userId)) }
}

/** Creates a brand-new vault. Returns the server payload, the in-memory key and the recovery key to show once. */
export async function createVault(password: string, userId: string) {
  const raw = randomBytes(32)
  const recovery = randomBytes(20)
  try {
    const { kdf, wrappedKey } = await wrapWithPassword(raw, password, userId)
    const recoveryWrappedKey = await seal(await recoveryKek(recovery, userId), raw, recoveryAad(userId))
    const keys: VaultKeysInput = { kdf, wrappedKey, recoveryWrappedKey }
    return { keys, vaultKey: await importAes(raw), recoveryKey: formatRecoveryKey(recovery) }
  } finally {
    raw.fill(0)
    recovery.fill(0)
  }
}

export async function unlockWithPassword(state: VaultStateDTO, password: string, userId: string): Promise<CryptoKey> {
  if (!state.kdf || !state.wrappedKey) throw new Error('Vault not initialised')
  const raw = await open(await passwordKek(password, state.kdf), state.wrappedKey, keyAad(userId))
  try {
    return await importAes(raw)
  } finally {
    raw.fill(0)
  }
}

/** Re-wraps the vault key under a new master password, given the current one. */
export async function changeMasterPassword(state: VaultStateDTO, current: string, next: string, userId: string): Promise<VaultKeysInput> {
  if (!state.kdf || !state.wrappedKey || !state.recoveryWrappedKey) throw new Error('Vault not initialised')
  const raw = await open(await passwordKek(current, state.kdf), state.wrappedKey, keyAad(userId))
  try {
    const { kdf, wrappedKey } = await wrapWithPassword(raw, next, userId)
    return { kdf, wrappedKey, recoveryWrappedKey: state.recoveryWrappedKey }
  } finally {
    raw.fill(0)
  }
}

/** Uses the recovery key to set a new master password. Item ciphertexts stay untouched. */
export async function recoverVault(state: VaultStateDTO, recoveryKey: string, next: string, userId: string) {
  if (!state.recoveryWrappedKey) throw new Error('Vault not initialised')
  const recovery = parseRecoveryKey(recoveryKey)
  if (!recovery) throw new WrongSecretError('Malformed recovery key')
  const raw = await open(await recoveryKek(recovery, userId), state.recoveryWrappedKey, recoveryAad(userId))
  try {
    const { kdf, wrappedKey } = await wrapWithPassword(raw, next, userId)
    const keys: VaultKeysInput = { kdf, wrappedKey, recoveryWrappedKey: state.recoveryWrappedKey }
    return { keys, vaultKey: await importAes(raw) }
  } finally {
    raw.fill(0)
    recovery.fill(0)
  }
}

export async function encryptItem(vaultKey: CryptoKey, userId: string, item: VaultItem): Promise<string> {
  return seal(vaultKey, enc.encode(JSON.stringify(item)), itemAad(userId, item.id))
}

export async function decryptItem(vaultKey: CryptoKey, userId: string, id: string, envelope: string): Promise<VaultItem> {
  const item = JSON.parse(dec.decode(await open(vaultKey, envelope, itemAad(userId, id)))) as VaultItem
  if (item.id !== id) throw new WrongSecretError('Item identity mismatch')
  return item
}
