import type { Context, Hono } from 'hono'
import type { Actor } from '../auth/actor'
import type { Env } from '../env'
import type { Services } from '../services'

export interface AppEnv {
  Variables: {
    actor: Actor | null
    services: Services
    config: Env
    clientIp: string
  }
}

/** What differs between runtimes (Node/Docker and Cloudflare). */
export interface Platform {
  /** Address of the caller, for rate limiting. */
  clientIp?: (c: Context<AppEnv>) => string
  /** Serves the web app; on Cloudflare static assets are served before the app is reached. */
  web?: (app: Hono<AppEnv>) => void
}
