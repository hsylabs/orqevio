import type { Database } from '../db/client'
import type { Env } from '../env'
import type { RealtimePublisher } from '../lib/realtime'
import type { AttachmentStorage } from '../lib/storage'

export interface Deps {
  db: Database
  bus: RealtimePublisher
  env: Env
  storage: AttachmentStorage
  /** Outgoing requests (the update check); tests pass their own. */
  fetch?: typeof fetch
  /**
   * Requests made on behalf of someone else, such as reading an OAuth client's
   * metadata: on Node it only reaches public addresses. Cloudflare's own fetch
   * cannot reach private networks, so the Worker leaves it unset.
   */
  publicFetch?: typeof fetch
}
