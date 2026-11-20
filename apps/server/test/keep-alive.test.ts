import { createServer, request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { KEEP_ALIVE_MS, keepConnectionsOpen } from '../src/node/keep-alive'

describe('idle connections', () => {
  it('stay open longer than a proxy keeps its own, and headers may take a little longer still', () => {
    const server = createServer()
    keepConnectionsOpen(server)
    expect(server.keepAliveTimeout).toBe(KEEP_ALIVE_MS)
    expect(KEEP_ALIVE_MS).toBeGreaterThan(60_000)
    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout)
  })

  it('are still open, and answer, after the 5 s (and the second Node adds) it gives them on its own', async () => {
    const server = createServer((_req, res) => res.end('ok'))
    keepConnectionsOpen(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const sockets = new Set<unknown>()
    const get = () =>
      new Promise<string>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port, agent, path: '/' }, (res) => {
          sockets.add(req.socket)
          res.setEncoding('utf8')
          let body = ''
          res.on('data', (chunk) => (body += chunk))
          res.on('end', () => resolve(body))
        })
        req.on('error', reject)
        req.end()
      })
    const { Agent } = await import('node:http')
    const agent = new Agent({ keepAlive: true, maxSockets: 1 })
    try {
      expect(await get()).toBe('ok')
      await new Promise((r) => setTimeout(r, 7_000))
      expect(await get()).toBe('ok')
      // The same connection both times: it was not closed while idle.
      expect(sockets.size).toBe(1)
    } finally {
      agent.destroy()
      await new Promise((resolve) => server.close(resolve))
    }
  }, 15_000)
})
