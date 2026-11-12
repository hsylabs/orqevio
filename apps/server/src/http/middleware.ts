import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Actor } from '../auth/actor'
import type { Env } from '../env'
import { AppError, forbidden, unauthorized } from '../lib/errors'
import { allowedOrigins } from './security'
import { SESSION_TTL_MS } from '../services/accounts'
import type { AppEnv } from './types'

export const sessionCookieName = (env: Env) => (env.secureCookies ? '__Host-orq_session' : 'orq_session')

export function setSessionCookie(c: Context<AppEnv>, token: string, expires: Date) {
  const env = c.get('config')
  setCookie(c, sessionCookieName(env), token, {
    httpOnly: true,
    secure: env.secureCookies,
    sameSite: 'Lax',
    path: '/',
    expires,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  })
}

export function clearSessionCookie(c: Context<AppEnv>) {
  const env = c.get('config')
  deleteCookie(c, sessionCookieName(env), { path: '/', secure: env.secureCookies })
}

export function bearerToken(c: Context) {
  const header = c.req.header('authorization')
  if (!header) return null
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  return match ? match[1]! : ''
}

/** Client address for rate limiting, resolved by the runtime (see `Platform.clientIp`). */
export function clientIp(c: Context<AppEnv>) {
  return c.get('clientIp')
}

/** Resolves the caller from a bearer agent token or the session cookie. */
export const resolveActor: MiddlewareHandler<AppEnv> = async (c, next) => {
  const services = c.get('services')
  let actor: Actor | null = null
  const token = bearerToken(c)
  if (token !== null) {
    actor = token ? await services.tokens.authenticate(token) : null
    if (!actor) throw new AppError(401, 'invalid_token', 'The agent token is invalid, expired or revoked')
  } else {
    const cookie = getCookie(c, sessionCookieName(c.get('config')))
    if (cookie) {
      const result = await services.accounts.authenticate(cookie)
      if (result) {
        actor = result.actor
        if (result.refreshed) setSessionCookie(c, cookie, result.refreshed)
      } else {
        clearSessionCookie(c)
      }
    }
  }
  c.set('actor', actor)
  await next()
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * CSRF defence for cookie-based requests: state-changing calls must come from
 * an allowed origin. Combined with SameSite=Lax cookies and JSON-only bodies.
 */
export const originGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (UNSAFE.has(c.req.method) && bearerToken(c) === null) {
    const origin = c.req.header('origin')
    const allowed = allowedOrigins(c.get('config'), c.req.url)
    if (origin) {
      if (!allowed.includes(origin)) throw forbidden('Cross-origin request rejected', 'bad_origin')
    } else {
      const site = c.req.header('sec-fetch-site')
      if (site && site !== 'same-origin' && site !== 'none') throw forbidden('Cross-site request rejected', 'bad_origin')
    }
  }
  await next()
}

/** Vault routes refuse any request carrying an Authorization header, before touching data. */
export const sessionOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.header('authorization')) {
    throw forbidden('The vault is never accessible to agents or API tokens.', 'vault_isolated')
  }
  await next()
}

export function requireActor(c: Context<AppEnv>): Actor {
  const actor = c.get('actor')
  if (!actor) throw unauthorized()
  return actor
}
