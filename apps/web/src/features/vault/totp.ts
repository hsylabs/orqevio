/**
 * Two-step verification codes (TOTP, RFC 6238, on top of HOTP, RFC 4226),
 * computed in the browser with WebCrypto: the secret never leaves the vault.
 */
export type TotpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512'

export interface TotpConfig {
  secret: Uint8Array<ArrayBuffer>
  algorithm: TotpAlgorithm
  digits: number
  period: number
  issuer: string
  account: string
}

export type TotpProblem = 'empty' | 'not_totp' | 'bad_secret' | 'too_short' | 'bad_parameters'

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const ALGORITHMS: Record<string, TotpAlgorithm> = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }
/** 80 bits, the shortest secret common services hand out. */
const MIN_SECRET_BYTES = 10

/** RFC 4648 base32, ignoring case, spaces, dashes and padding; null if invalid. */
export function base32Decode(input: string): Uint8Array<ArrayBuffer> | null {
  const clean = input.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '')
  if (!clean || /[^A-Z2-7]/.test(clean)) return null
  const out: number[] = []
  let bits = 0
  let value = 0
  for (const ch of clean) {
    value = ((value << 5) | BASE32.indexOf(ch)) & 0xffff
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

/** Reads the secret a service shows when two-step verification is turned on: an otpauth:// link or the bare base32 secret. */
export function parseTotp(input: string): TotpConfig | TotpProblem {
  const text = input.trim()
  if (!text) return 'empty'
  const config: TotpConfig = { secret: new Uint8Array(0), algorithm: 'SHA-1', digits: 6, period: 30, issuer: '', account: '' }
  let secretText = text
  if (/^otpauth:/i.test(text)) {
    let url: URL
    try {
      url = new URL(text)
    } catch {
      return 'bad_parameters'
    }
    if (url.host.toLowerCase() !== 'totp') return 'not_totp'
    const label = safeDecode(url.pathname.replace(/^\//, ''))
    const colon = label.indexOf(':')
    config.account = (colon >= 0 ? label.slice(colon + 1) : label).trim()
    config.issuer = (url.searchParams.get('issuer') ?? (colon >= 0 ? label.slice(0, colon) : '')).trim()
    secretText = url.searchParams.get('secret') ?? ''
    const algorithm = url.searchParams.get('algorithm')
    const digits = url.searchParams.get('digits')
    const period = url.searchParams.get('period')
    if (algorithm !== null) {
      const known = ALGORITHMS[algorithm.toUpperCase().replace('-', '')]
      if (!known) return 'bad_parameters'
      config.algorithm = known
    }
    if (digits !== null) config.digits = Number(digits)
    if (period !== null) config.period = Number(period)
    if (!Number.isInteger(config.digits) || config.digits < 6 || config.digits > 8) return 'bad_parameters'
    if (!Number.isInteger(config.period) || config.period < 1 || config.period > 300) return 'bad_parameters'
  }
  const secret = base32Decode(secretText)
  if (!secret) return 'bad_secret'
  if (secret.length < MIN_SECRET_BYTES) return 'too_short'
  config.secret = secret
  return config
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** HOTP (RFC 4226): the code for one counter value. */
export async function hotp(secret: Uint8Array<ArrayBuffer>, counter: number, algorithm: TotpAlgorithm = 'SHA-1', digits = 6) {
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: algorithm }, false, ['sign'])
  const message = new DataView(new ArrayBuffer(8))
  message.setUint32(0, Math.floor(counter / 2 ** 32))
  message.setUint32(4, counter >>> 0)
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message.buffer))
  const offset = mac[mac.length - 1]! & 0x0f
  const binary = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!
  return String(binary % 10 ** digits).padStart(digits, '0')
}

/** TOTP (RFC 6238): the current code and how many seconds it stays valid. */
export async function totp(config: Pick<TotpConfig, 'secret' | 'algorithm' | 'digits' | 'period'>, nowMs = Date.now()) {
  const seconds = Math.floor(nowMs / 1000)
  const code = await hotp(config.secret, Math.floor(seconds / config.period), config.algorithm, config.digits)
  return { code, remaining: config.period - (seconds % config.period) }
}

/** "123456" → "123 456", easier to read and type. */
export const groupCode = (code: string) => (code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : `${code.slice(0, 3)} ${code.slice(3)}`)
