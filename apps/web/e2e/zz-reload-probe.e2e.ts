import http from 'node:http'
import net from 'node:net'
import { test } from '@playwright/test'

// Probe (not part of the suite): what each engine reports when a reload cuts API requests that
// the app itself made and is still waiting for. A proxy in front of the copy delays every API
// response, so the reload always lands while they are in flight.
const DELAY = 2500
const PORT = 3100
let mode: 'headers' | 'body' | 'none' = 'headers'

test('probe: a reload cuts the app own API requests in flight', async ({ page, baseURL }) => {
  const target = new URL(baseURL!)
  const server = http.createServer((req, res) => {
    const forward = () => {
      const upstream = http.request({ host: '127.0.0.1', port: target.port, path: req.url, method: req.method, headers: { ...req.headers, host: target.host, ...(req.headers.origin ? { origin: target.origin } : {}) } }, (r) => {
        if (mode === 'body' && req.url!.startsWith('/api/')) {
          // The headers at once, the body a while later: the reload lands while it is being read.
          const { 'content-length': _length, ...headers } = r.headers
          res.writeHead(r.statusCode!, headers)
          res.write(' ')
          setTimeout(() => r.pipe(res), DELAY)
        } else {
          res.writeHead(r.statusCode!, r.headers)
          r.pipe(res)
        }
      })
      upstream.on('error', () => res.destroy())
      req.pipe(upstream)
    }
    if (mode === 'headers' && req.url!.startsWith('/api/')) setTimeout(forward, DELAY)
    else forward()
  })
  // Live updates go through a WebSocket: pass it through untouched.
  server.on('upgrade', (req, socket, head) => {
    const upstream = net.connect(Number(target.port), '127.0.0.1', () => {
      upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries({ ...req.headers, host: target.host, ...(req.headers.origin ? { origin: target.origin } : {}) }).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`)
      upstream.write(head)
      socket.pipe(upstream).pipe(socket)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  })
  await new Promise<void>((resolve) => server.listen(PORT, resolve))
  const log: string[] = []
  page.on('pageerror', (e) => log.push(`pageerror: ${e.name}: ${e.message}`))
  page.on('console', (m) => {
    if (!['debug'].includes(m.type())) log.push(`console.${m.type()}: ${m.text()}`)
  })
  page.on('requestfailed', (r) => log.push(`requestfailed: ${r.method()} ${new URL(r.url()).pathname} — ${r.failure()?.errorText}`))
  page.on('request', (r) => r.url().includes('/api/') && log.push(`request: ${r.method()} ${r.url()}`))
  page.on('response', (r) => r.url().includes('/api/') && log.push(`response: ${r.status()} ${r.url()}`))
  page.on('framenavigated', (f) => f === page.mainFrame() && log.push(`navigated: ${new URL(f.url()).pathname}`))

  // A new tab's first navigation can get lost (see settle in helpers.ts): open a small page first.
  await page.goto(`http://localhost:${PORT}/healthz`)
  for (const [where, how] of [['/', 'headers'], ['/', 'body'], ['/', 'body']] as const) {
    mode = how
    log.push(`=== ${where}, slow ${how}: reload while the first API requests wait`)
    const started = page.waitForRequest((r) => new URL(r.url()).pathname.startsWith('/api/'), { timeout: 20_000 })
    await page.goto(`http://localhost:${PORT}${where}`, { waitUntil: 'commit' })
    const ok = await started.then(() => true, () => false)
    if (!ok) {
      log.push(`no API request; page: ${page.url()} ${(await page.content().catch(() => '')).slice(0, 600)}`)
      break
    }
    await page.waitForTimeout(500)
    log.push('--- reload')
    await page.reload({ waitUntil: 'commit' })
    await page.waitForTimeout(DELAY * 3)
  }
  // Requests that start while the page is going away, as a live refresh or a reconnection could.
  for (const variant of ['pagehide, caught', 'pagehide, uncaught', 'beforeunload, caught', 'timer during unload, caught'] as const) {
    mode = 'none' as never
    log.push(`=== fetch started on ${variant}`)
    await page.goto(`http://localhost:${PORT}/healthz`)
    await page.evaluate((v) => {
      const go = (caught: boolean) => {
        const p = fetch(`/api/auth/session?probe=${encodeURIComponent(v)}`)
        if (caught) p.catch((e) => console.log(`caught: ${e.name}: ${e.message}`))
      }
      if (v === 'pagehide, caught') addEventListener('pagehide', () => go(true))
      if (v === 'pagehide, uncaught') addEventListener('pagehide', () => go(false))
      if (v === 'beforeunload, caught') addEventListener('beforeunload', () => go(true))
      if (v === 'timer during unload, caught') addEventListener('pagehide', () => setTimeout(() => go(true), 0))
    }, variant)
    log.push('--- reload')
    await page.reload()
    await page.waitForTimeout(1500)
  }
  log.push('=== done')
  await page.waitForTimeout(100)
  console.log(`PROBE ${process.env.E2E_BROWSER ?? 'chromium'}\n${log.join('\n')}`)
  server.close()
})
