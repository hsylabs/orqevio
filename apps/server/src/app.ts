import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import type { Env } from './env'
import { createApi } from './http/api'
import type { AppEnv } from './http/types'
import { AppError } from './lib/errors'
import { handleMcp } from './mcp/http'
import type { Services } from './services'

const baseCsp = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
  fontSrc: ["'self'", 'data:'],
  connectSrc: ["'self'"],
  workerSrc: ["'self'", 'blob:'],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  objectSrc: ["'none'"],
}

export function createApp(env: Env, services: Services) {
  const app = new Hono<AppEnv>()
  // Live updates use WebSocket; list the app's own ws(s) origins explicitly, since
  // not every browser lets 'self' cover them.
  const CSP = {
    ...baseCsp,
    connectSrc: ["'self'", ...env.appUrls.map((url) => url.replace(/^http/, 'ws'))],
  }

  app.use('*', async (c, next) => {
    c.set('services', services)
    c.set('config', env)
    c.set('actor', null)
    await next()
  })

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: CSP,
      strictTransportSecurity: env.secureCookies ? 'max-age=63072000; includeSubDomains' : false,
      xFrameOptions: 'DENY',
      referrerPolicy: 'strict-origin-when-cross-origin',
      crossOriginEmbedderPolicy: false,
      permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [] },
    }),
  )

  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json({ error: { code: error.code, message: error.message, details: error.details } }, error.status)
    }
    console.error('[http] unhandled error', error)
    return c.json({ error: { code: 'internal', message: 'Something went wrong' } }, 500)
  })

  app.get('/healthz', (c) => c.json({ ok: true }))
  app.route('/api', createApi(env))
  app.all('/mcp', handleMcp)

  // ── Web app (production build) ─────────────────────────────────
  const indexFile = path.join(env.webDist, 'index.html')
  if (existsSync(indexFile)) {
    const indexHtml = readFileSync(indexFile, 'utf8')
    app.use(
      '/assets/*',
      serveStatic({
        root: env.webDist,
        onFound: (_path, c) => {
          c.header('Cache-Control', 'public, max-age=31536000, immutable')
        },
      }),
    )
    app.use('*', serveStatic({ root: env.webDist, index: '__none__' }))
    app.get('*', (c) => {
      c.header('Cache-Control', 'no-cache')
      return c.html(indexHtml)
    })
  } else {
    app.get('/', (c) => c.text('Orqevio API is running. Build the web app (pnpm build) to serve the interface.'))
  }

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found' } }, 404))
  return app
}
