import type { Database } from '../db/client'
import type { Env } from '../env'
import type { RealtimeBus } from '../lib/realtime'
import type { LocalStorage } from '../lib/storage'

export interface Deps {
  db: Database
  bus: RealtimeBus
  env: Env
  storage: LocalStorage
}
