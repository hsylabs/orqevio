import type { Actor } from '../auth/actor'
import type { Env } from '../env'
import type { Services } from '../services'

export interface AppEnv {
  Variables: {
    actor: Actor | null
    services: Services
    config: Env
  }
}
