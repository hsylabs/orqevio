import type { UpdateStatusDTO } from '@orqevio/shared'
import type { Actor } from '../auth/actor'
import { VERSION } from '../version'
import type { Access } from './access'
import type { Deps } from './deps'

// The npm package is published with every release (see RELEASING.md), so its
// "latest" tag is the newest version of every kind of copy.
const REGISTRY = 'https://registry.npmjs.org/orqevio/latest'
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

/**
 * Tells the owner when a newer version is out. The copy itself asks the npm
 * registry (a plain GET, nothing about the copy is sent), at most every 12 hours
 * and only while someone uses the app; UPDATE_CHECK=off turns it off.
 */
export class UpdateService {
  private cache: { latest: string | null; at: number } | null = null
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
    const cached = this.cache
    if (cached && Date.now() - cached.at < (cached.latest ? FRESH_MS : RETRY_MS)) return cached.latest
    this.pending ??= this.fetchLatest().finally(() => {
      this.pending = null
    })
    const latest = await this.pending
    this.cache = { latest, at: Date.now() }
    return latest
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
