import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { getConnInfo } from '@hono/node-server/conninfo'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Env } from '../env'
import { forwardedClient } from '../http/client-ip'
import type { Platform } from '../http/types'

/** Node/Docker: the caller's address comes from the socket, and the web build is served from disk. */
export function nodePlatform(env: Env): Platform {
  let warned = false
  return {
    clientIp(c) {
      const header = c.req.header('x-forwarded-for')
      const forwarded = forwardedClient(header, env.trustProxy)
      if (forwarded) return forwarded
      if (header && !env.trustProxy && !warned) {
        warned = true
        console.warn(
          'Requests come through a reverse proxy (X-Forwarded-For), but TRUST_PROXY is off: every visitor counts as the proxy for the limits on failed sign-ins. Set TRUST_PROXY=true (or the number of proxies in front).',
        )
      }
      try {
        return getConnInfo(c).remote.address ?? 'unknown'
      } catch {
        return 'unknown'
      }
    },
    web(app) {
      const indexFile = path.join(env.webDist, 'index.html')
      if (!existsSync(indexFile)) {
        app.get('/', (c) => c.text('Orqevio API is running. Build the web app (pnpm build) to serve the interface.'))
        return
      }
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
    },
  }
}
