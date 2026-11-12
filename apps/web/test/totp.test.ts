import { describe, expect, it } from 'vitest'
import { base32Decode, groupCode, hotp, parseTotp, totp } from '../src/features/vault/totp'

const ascii = (text: string) => new TextEncoder().encode(text)

describe('TOTP', () => {
  it('matches the RFC 4226 HOTP test values', async () => {
    const secret = ascii('12345678901234567890')
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489']
    for (const [counter, code] of expected.entries()) expect(await hotp(secret, counter)).toBe(code)
  })

  it('matches the RFC 6238 test vectors for SHA-1, SHA-256 and SHA-512', async () => {
    const secrets = {
      'SHA-1': ascii('12345678901234567890'),
      'SHA-256': ascii('12345678901234567890123456789012'),
      'SHA-512': ascii('1234567890123456789012345678901234567890123456789012345678901234'),
    } as const
    const vectors: Array<[number, Record<keyof typeof secrets, string>]> = [
      [59, { 'SHA-1': '94287082', 'SHA-256': '46119246', 'SHA-512': '90693936' }],
      [1111111109, { 'SHA-1': '07081804', 'SHA-256': '68084774', 'SHA-512': '25091201' }],
      [1111111111, { 'SHA-1': '14050471', 'SHA-256': '67062674', 'SHA-512': '99943326' }],
      [1234567890, { 'SHA-1': '89005924', 'SHA-256': '91819424', 'SHA-512': '93441116' }],
      [2000000000, { 'SHA-1': '69279037', 'SHA-256': '90698825', 'SHA-512': '38618901' }],
      [20000000000, { 'SHA-1': '65353130', 'SHA-256': '77737706', 'SHA-512': '47863826' }],
    ]
    for (const [time, codes] of vectors) {
      for (const algorithm of ['SHA-1', 'SHA-256', 'SHA-512'] as const) {
        const { code } = await totp({ secret: secrets[algorithm], algorithm, digits: 8, period: 30 }, time * 1000)
        expect(code, `${algorithm} at ${time}`).toBe(codes[algorithm])
      }
    }
  })

  it('reads the bare base32 secret a service shows, as an authenticator app would', async () => {
    // "12345678901234567890" in base32, typed in lowercase groups.
    const config = parseTotp('gezd gnbv gy3t qojq gezd gnbv gy3t qojq')
    if (typeof config === 'string') throw new Error(config)
    expect(config).toMatchObject({ algorithm: 'SHA-1', digits: 6, period: 30, issuer: '', account: '' })
    expect(await totp(config, 59_000)).toEqual({ code: '287082', remaining: 1 })
    expect((await totp(config, 60_000)).remaining).toBe(30)
  })

  it('reads otpauth:// links, with their issuer, account and parameters', () => {
    const google = parseTotp('otpauth://totp/Example:alice@google.com?secret=JBSWY3DPEHPK3PXP&issuer=Example')
    expect(google).toMatchObject({ issuer: 'Example', account: 'alice@google.com', algorithm: 'SHA-1', digits: 6, period: 30 })
    const custom = parseTotp('otpauth://totp/ACME%20Co:john.doe%40email.com?secret=HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ&algorithm=SHA256&digits=8&period=60')
    expect(custom).toMatchObject({ issuer: 'ACME Co', account: 'john.doe@email.com', algorithm: 'SHA-256', digits: 8, period: 60 })
  })

  it('explains what is wrong with what was pasted', () => {
    expect(parseTotp('  ')).toBe('empty')
    expect(parseTotp('otpauth://hotp/X?secret=JBSWY3DPEHPK3PXP&counter=0')).toBe('not_totp')
    expect(parseTotp('no-es-base32!')).toBe('bad_secret')
    expect(parseTotp('JBSWY3DP')).toBe('too_short')
    expect(parseTotp('otpauth://totp/X?secret=JBSWY3DPEHPK3PXP&digits=10')).toBe('bad_parameters')
    expect(parseTotp('otpauth://totp/X?secret=JBSWY3DPEHPK3PXP&algorithm=MD5')).toBe('bad_parameters')
  })

  it('decodes base32 as RFC 4648 defines it', () => {
    expect(new TextDecoder().decode(base32Decode('MZXW6YTBOI======')!)).toBe('foobar')
    expect(new TextDecoder().decode(base32Decode('mzxw6ytb')!)).toBe('fooba')
    expect(base32Decode('1189')).toBeNull()
    expect(groupCode('287082')).toBe('287 082')
    expect(groupCode('94287082')).toBe('9428 7082')
  })
})
