import { type LookupAddress, lookup } from 'node:dns'
import { request } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { Readable } from 'node:stream'

/**
 * Addresses a request on behalf of a visitor must never reach: this host, the
 * local network and other special-purpose ranges (RFC 6890 and friends).
 */
const blocked = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6')
}

/** True for an address on the public Internet. */
export function isPublicAddress(address: string) {
  const family = isIP(address)
  if (family === 0) return false
  if (family === 6) {
    // IPv4-mapped (::ffff:a.b.c.d) addresses are judged by their IPv4 part.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
    if (mapped) return isPublicAddress(mapped[1]!)
    if (/^::ffff:/i.test(address)) return false
  }
  return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6')
}

export class AddressNotPublicError extends Error {
  readonly code = 'ERR_ADDRESS_NOT_PUBLIC'
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void

/**
 * Resolves like dns.lookup, but fails when any resolved address is not public.
 * The connection uses exactly these addresses, so a DNS answer that changes
 * between a check and the connection (DNS rebinding) cannot get through.
 */
function publicLookup(hostname: string, options: { all?: boolean; family?: number }, callback: LookupCallback) {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, [])
    const list = addresses as LookupAddress[]
    if (list.length === 0 || !list.every((a) => isPublicAddress(a.address))) {
      return callback(new AddressNotPublicError(`${hostname} does not resolve to a public address`), [])
    }
    if (options.all) return callback(null, list)
    callback(null, list[0]!.address, list[0]!.family)
  })
}

/**
 * fetch() for requests made on behalf of someone else (an OAuth client's
 * metadata document): https only, public addresses only, no redirects followed.
 */
export function publicFetch(input: URL | string | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.protocol !== 'https:') return Promise.reject(new TypeError('Only https requests are allowed'))
  const headers = Object.fromEntries(new Headers(init.headers).entries())
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', headers, lookup: publicLookup as never, signal: init.signal ?? undefined, timeout: 10_000 }, (res) => {
      const status = res.statusCode ?? 502
      const responseHeaders = new Headers()
      for (const [name, value] of Object.entries(res.headers)) {
        if (value === undefined) continue
        for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(name, item)
      }
      const empty = [101, 204, 205, 304].includes(status) || status < 200
      if (empty) res.resume()
      resolve(new Response(empty ? null : (Readable.toWeb(res) as ReadableStream), { status: status < 200 ? 502 : status, headers: responseHeaders }))
    })
    req.on('timeout', () => req.destroy(new Error('Request timed out')))
    req.on('error', reject)
    req.end()
  })
}
