import { describe, expect, it } from 'vitest'
import { isPublicAddress, publicFetch } from '../src/node/public-fetch'

describe('requests on behalf of others (Node)', () => {
  it('tells public addresses from local and special ones', () => {
    for (const address of ['93.184.215.14', '1.1.1.1', '2606:4700:4700::1111', '::ffff:93.184.215.14']) expect(isPublicAddress(address), address).toBe(true)
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.5',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fe80::1',
      'fd12:3456::1',
      '::ffff:127.0.0.1',
      '::ffff:192.168.1.1',
      '64:ff9b::7f00:1',
      '2002:7f00:1::',
      'not-an-address',
    ]) {
      expect(isPublicAddress(address), address).toBe(false)
    }
  })

  it('refuses a name that resolves to this host or the local network, before connecting', async () => {
    await expect(publicFetch('https://localhost/client.json')).rejects.toMatchObject({ code: 'ERR_ADDRESS_NOT_PUBLIC' })
    await expect(publicFetch('http://example.com/client.json')).rejects.toThrow('Only https')
  })
})
