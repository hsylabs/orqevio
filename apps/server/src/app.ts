import { Hono } from 'hono'
import type { Env } from './env'
import { createApi } from './http/api'
import { createOAuthRoutes } from './http/oauth'
import { allowedOrigins, securityHeaders } from './http/security'
import type { AppEnv, Platform } from './http/types'
import { AppError } from './lib/errors'
import { handleMcp } from './mcp/http'
import type { Services } from './services'

/** Without a platform-specific resolver, trust X-Forwarded-For only when configured to. */
function defaultClientIp(env: Env) {
  return (c: Parameters<NonNullable<Platform['clientIp']>>[0]) =>
    (env.trustProxy ? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() : undefined) || 'unknown'
}

export function createApp(env: Env, services: Services, platform: Platform = {}) {
  const resolveClientIp = platform.clientIp ?? defaultClientIp(env)
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('services', services)
    c.set('config', env)
    c.set('actor', null)
    c.set('clientIp', resolveClientIp(c))
    await next()
  })

  app.use('*', async (c, next) => {
    await next()
    const headers = securityHeaders(allowedOrigins(env, c.req.url), env.secureCookies)
    for (const [name, value] of Object.entries(headers)) if (!c.res.headers.has(name)) c.res.headers.set(name, value)
  })

  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json({ error: { code: error.code, message: error.message, details: error.details } }, error.status)
    }
    console.error('[http] unhandled error', error)
    return c.json({ error: { code: 'internal', message: 'Something went wrong' } }, 500)
  })

  app.get('/healthz', (c) => c.json({ ok: true }))
  app.route('/', createOAuthRoutes())
  app.route('/api', createApi(env))
  app.all('/mcp', handleMcp)

  platform.web?.(app)

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found' } }, 404))
  return app
}
