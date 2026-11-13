import { randomBytes } from 'node:crypto'

// Same format as the setup codes the server generates: Crockford base32 (no I, L,
// O or U), 80 random bits in four groups of four characters.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function generateSetupCode(bytes: Uint8Array = randomBytes(10)) {
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
  return out.match(/.{1,4}/g)!.join('-')
}
