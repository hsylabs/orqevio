import type { Database } from '../db/client'
import type { Env } from '../env'
import type { RealtimePublisher } from '../lib/realtime'
import type { AttachmentStorage } from '../lib/storage'

export interface Deps {
  db: Database
  bus: RealtimePublisher
  env: Env
  storage: AttachmentStorage
}
