import type { UpdateStatusDTO } from '@orqevio/shared'
import { eq } from 'drizzle-orm'
import type { Actor } from '../auth/actor'
import { copyState } from '../db/schema'
import { VERSION } from '../version'
import type { Access } from './access'
import type { Deps } from './deps'

// The release workflow publishes create-orqevio last, after the Docker image and
// the orqevio package (see RELEASING.md): once its "latest" tag moves, every kind
// of copy can install that version.
const REGISTRY = 'https://registry.npmjs.org/create-orqevio/latest'
const CACHE_KEY = 'update_check'
const RELEASES = 'https://github.com/hsylabs/orqevio/releases/tag/v'
const FRESH_MS = 12 * 60 * 60 * 1000
const RETRY_MS = 60 * 60 * 1000
const TIMEOUT_MS = 3000
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

/** Whether version `a` is newer than `b` (a pre-release comes before its release). */
export function isNewer(a: string, b: string) {
  const pa = SEMVER.exec(a)
  const pb = SEMVER.exec(b)
  if (!pa || !pb) return false
  for (let i = 1; i <= 3; i++) {
    const diff = Number(pa[i]) - Number(pb[i])
    if (diff !== 0) return diff > 0
  }
  if (pa[4] === pb[4]) return false
  if (!pa[4]) return true
  if (!pb[4]) return false
  return pa[4].localeCompare(pb[4], 'en', { numeric: true }) > 0
}

interface CachedCheck {
  latest: string | null
  at: number
}

/**
 * Tells the owner when a newer version is out. The copy itself asks the npm
 * registry (a plain GET, nothing about the copy is sent), at most every 12 hours
 * and only while someone uses the app; UPDATE_CHECK=off turns it off. The last
 * answer is kept in the database, so restarts (and Durable Object hibernation)
 * do not cause extra requests.
 */
export class UpdateService {
  private pending: Promise<string | null> | null = null

  constructor(
    private readonly deps: Deps,
    private readonly access: Access,
  ) {}

  async status(actor: Actor): Promise<UpdateStatusDTO> {
    this.access.requireUser(actor)
    const { install, copyName, updateCheck } = this.deps.env
    const latest = updateCheck ? await this.latest() : null
    const updateAvailable = latest !== null && isNewer(latest, VERSION)
    return { current: VERSION, latest, updateAvailable, install, copyName, releaseUrl: updateAvailable ? `${RELEASES}${latest}` : null }
  }

  private async latest() {
    const cached = this.readCache()
    if (cached && Date.now() - cached.at < (cached.latest ? FRESH_MS : RETRY_MS)) return cached.latest
    this.pending ??= this.fetchLatest()
      .then((latest) => {
        this.writeCache({ latest, at: Date.now() })
        return latest
      })
      .finally(() => {
        this.pending = null
      })
    return this.pending
  }

  private readCache(): CachedCheck | null {
    const row = this.deps.db.select({ value: copyState.value }).from(copyState).where(eq(copyState.key, CACHE_KEY)).get()
    if (!row) return null
    try {
      const cached = JSON.parse(row.value) as CachedCheck
      return typeof cached.at === 'number' ? cached : null
    } catch {
      return null
    }
  }

  private writeCache(check: CachedCheck) {
    const value = JSON.stringify(check)
    const updatedAt = new Date()
    this.deps.db
      .insert(copyState)
      .values({ key: CACHE_KEY, value, updatedAt })
      .onConflictDoUpdate({ target: copyState.key, set: { value, updatedAt } })
      .run()
  }

  private async fetchLatest(): Promise<string | null> {
    try {
      const res = await (this.deps.fetch ?? fetch)(REGISTRY, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!res.ok) return null
      const { version } = (await res.json()) as { version?: unknown }
      return typeof version === 'string' && SEMVER.test(version) ? version : null
    } catch {
      return null
    }
  }
}
