import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

// ── Access keys and setup codes ─────────────────────────────────
// Crockford base32: no I, L, O or U, so keys survive being read aloud or retyped.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function crockford(bytes: Uint8Array) {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff
    bits += 8
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31]
  return out
}

const grouped = (value: string) => value.match(/.{1,4}/g)!.join('-')

/** 160 random bits, shown as eight groups of four characters (XXXX-XXXX-…). */
export const generateAccessKey = () => grouped(crockford(randomBytes(20)))

/** 80 random bits, used when the operator did not set SETUP_CODE. */
export const generateSetupCode = () => grouped(crockford(randomBytes(10)))

/**
 * Case, spaces and dashes do not matter, and the letters that Crockford base32
 * leaves out are read as the digits they resemble.
 */
export const normalizeSecret = (value: string) =>
  value.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')

export const secretFingerprint = (value: string) => sha256(normalizeSecret(value))
