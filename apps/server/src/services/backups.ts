import { type BackupDTO, type BackupKind, type BackupsDTO, restoreBackupInput } from '@orqevio/shared'
import type { Actor } from '../auth/actor'
import { DUMP_FORMAT, DUMP_VERSION, DumpError, currentMigration, readHeader, restoreDump, writeDump } from '../backups/dump'
import { AppError, notFound } from '../lib/errors'
import { parse } from '../lib/validate'
import { VERSION } from '../version'
import type { Access } from './access'
import type { AccountService } from './accounts'
import type { AttachmentService } from './attachments'
import type { Deps } from './deps'
import type { OAuthService } from './oauth'

/** Daily (and manual) backups kept; the newest one made before a restore is kept besides them. */
export const KEEP_BACKUPS = 7
/** A backup is due a day after the last one: checked every hour, so a little earlier is fine. */
const DUE_AFTER_MS = 23.5 * 60 * 60 * 1000
/** A backup whose manifest never got written (it stopped half-way) goes after this long. */
const UNFINISHED_AFTER_MS = 6 * 60 * 60 * 1000

interface Manifest {
  format: typeof DUMP_FORMAT
  version: typeof DUMP_VERSION
  id: string
  kind: BackupKind
  createdAt: string
  app: string
  migration: number
  data: { bytes: number; sha256: string }
  counts: BackupDTO['counts']
  files: Array<{ key: string; size: number }>
  missingFiles: string[]
}

const backupsOff = () => new AppError(409, 'backups_off', 'This copy makes no backups')
const dataKey = (id: string) => `snapshots/${id}/data.ndjson.gz`
const manifestKey = (id: string) => `snapshots/${id}/manifest.json`
const fileKey = (storageKey: string) => `files/${storageKey}`
const SNAPSHOT = /^snapshots\/([0-9A-Za-z-]+)\/(data\.ndjson\.gz|manifest\.json)$/

async function sha256(data: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Automatic backups of the whole copy, kept apart from it: on Node in a folder (BACKUP_DIR), on
 * Cloudflare in a second R2 bucket. Each one has everything as it is (the encrypted vault, the
 * trash, the history and the attachments) and can be put back from Settings. Only the person
 * who owns the copy sees, makes and restores them.
 */
export class BackupService {
  /** A backup or a restore running: they never overlap. */
  private running: Promise<unknown> | null = null

  constructor(
    private readonly deps: Deps,
    private readonly access: Access,
    private readonly accounts: AccountService,
    private readonly attachments: AttachmentService,
    private readonly oauth: OAuthService,
  ) {}

  get enabled() {
    return Boolean(this.deps.backups && this.deps.sql)
  }

  async status(actor: Actor): Promise<BackupsDTO> {
    this.access.requireUser(actor)
    if (!this.enabled) return { where: null, keep: KEEP_BACKUPS, backups: [] }
    const migration = currentMigration(this.deps.sql!)
    const manifests = await this.manifests()
    return { where: this.deps.backups!.where, keep: KEEP_BACKUPS, backups: manifests.map((m) => this.toDTO(m, migration)) }
  }

  /** "Back up now", from Settings. */
  async createNow(actor: Actor): Promise<BackupDTO> {
    this.access.requireUser(actor)
    if (!this.enabled) throw backupsOff()
    const manifest = await this.exclusive(() => this.create('manual'))
    return this.toDTO(manifest, currentMigration(this.deps.sql!))
  }

  /** Hourly: makes the daily backup once the last one is a day old, for a copy that is claimed and in use. */
  async runIfDue(now = Date.now()) {
    if (!this.enabled || this.running || !(await this.inUse())) return null
    const latest = (await this.manifests()).find((m) => m.kind !== 'before-restore')
    if (latest && now - Date.parse(latest.createdAt) < DUE_AFTER_MS) return null
    return this.exclusive(() => this.create('daily'))
  }

  /** An empty copy (not claimed yet, or uninstalled) makes no backups: they would push out the ones that matter. */
  private async inUse() {
    if (await this.accounts.uninstalled()) return false
    return (await this.accounts.state()).claimed
  }

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.running) throw new AppError(409, 'backup_running', 'A backup or a restore is already running')
    const run = work()
    this.running = run
    try {
      return await run
    } finally {
      this.running = null
    }
  }

  private async manifests(): Promise<Manifest[]> {
    const store = this.deps.backups!
    const keys = await store.list('snapshots/')
    const ids = keys.map((k) => SNAPSHOT.exec(k.key)).filter((m) => m?.[2] === 'manifest.json').map((m) => m![1]!)
    const manifests: Manifest[] = []
    for (const id of ids) {
      const bytes = await store.read(manifestKey(id))
      if (!bytes) continue
      try {
        const manifest = JSON.parse(new TextDecoder().decode(bytes)) as Manifest
        if (manifest.format === DUMP_FORMAT && manifest.id === id) manifests.push(manifest)
      } catch {
        // Not readable: neither listed nor restored.
      }
    }
    return manifests.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))
  }

  private toDTO(m: Manifest, migration: number): BackupDTO {
    const files = m.files.reduce((sum, f) => sum + f.size, 0)
    return {
      id: m.id,
      kind: m.kind,
      createdAt: m.createdAt,
      version: m.app,
      bytes: m.data.bytes + files,
      counts: m.counts,
      files: m.files.length,
      missingFiles: m.missingFiles.length,
      newer: m.migration > migration,
    }
  }

  /**
   * One backup: the database in one synchronous read (a consistent snapshot, even on Cloudflare
   * where requests interleave at every await), then the attachments it lists that the store
   * doesn't have yet, and last its manifest: a backup without one is unfinished and never listed.
   */
  private async create(kind: BackupKind): Promise<Manifest> {
    const store = this.deps.backups!
    const sql = this.deps.sql!
    const now = new Date()
    const id = now.toISOString().replace(/[:.]/g, '-')
    const dump = writeDump(sql, VERSION, now)
    const listed = new Map<string, number>()
    for (const [key, size] of sql.rows(
      "SELECT storage_key, size FROM attachments UNION ALL SELECT storage_key, json_extract(data, '$.size') FROM trash_rows WHERE storage_key IS NOT NULL",
    )) {
      if (typeof key === 'string') listed.set(key, Number(size ?? 0))
    }
    const migration = currentMigration(sql)
    const count = (table: string) => dump.counts[table] ?? 0

    await store.write(dataKey(id), dump.data)
    const stored = new Set((await store.list('files/')).map((f) => f.key))
    const files: Manifest['files'] = []
    const missingFiles: string[] = []
    for (const [key, size] of listed) {
      if (!stored.has(fileKey(key))) {
        try {
          const body = await this.deps.storage.stream(key)
          if (!body) {
            missingFiles.push(key)
            continue
          }
          await store.writeStream(fileKey(key), body, size)
        } catch (error) {
          console.error(`[backups] could not copy ${key}`, error)
          missingFiles.push(key)
          continue
        }
      }
      files.push({ key, size })
    }

    const manifest: Manifest = {
      format: DUMP_FORMAT,
      version: DUMP_VERSION,
      id,
      kind,
      createdAt: now.toISOString(),
      app: VERSION,
      migration,
      data: { bytes: dump.data.length, sha256: await sha256(dump.data) },
      counts: {
        workspaces: count('workspaces'),
        projects: count('projects'),
        boards: count('boards'),
        cards: count('cards'),
        pages: count('pages'),
        attachments: count('attachments'),
        vaultItems: count('vault_items'),
        trash: count('trash'),
      },
      files,
      missingFiles,
    }
    await store.write(manifestKey(id), new TextEncoder().encode(JSON.stringify(manifest)))
    await this.prune(now.getTime())
    return manifest
  }

  /**
   * Keeps the KEEP_BACKUPS newest daily or manual backups and the newest one made before a
   * restore, removes the rest and the unfinished ones, then the attachments none of those kept lists.
   */
  private async prune(now: number) {
    const store = this.deps.backups!
    const manifests = await this.manifests()
    const regular = manifests.filter((m) => m.kind !== 'before-restore')
    const kept = [...regular.slice(0, KEEP_BACKUPS), ...manifests.filter((m) => m.kind === 'before-restore').slice(0, 1)]
    const keptIds = new Set(kept.map((m) => m.id))
    const listed = await store.list('snapshots/')
    const withManifest = new Set(manifests.map((m) => m.id))
    const doomed: string[] = []
    for (const { key } of listed) {
      const id = SNAPSHOT.exec(key)?.[1]
      if (!id || keptIds.has(id)) continue
      // An unfinished one may still be being written: it goes once it is clearly abandoned.
      const at = Date.parse(id.replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, '$1:$2:$3.$4Z'))
      if (!withManifest.has(id) && !(now - at > UNFINISHED_AFTER_MS)) continue
      doomed.push(key)
    }
    // Manifests before data: a backup half-deleted is an unfinished one, cleaned up next time.
    doomed.sort((a, b) => Number(b.endsWith('manifest.json')) - Number(a.endsWith('manifest.json')))
    if (doomed.length) await store.delete(doomed)

    const needed = new Set(kept.flatMap((m) => m.files.map((f) => fileKey(f.key))))
    const unused = (await store.list('files/')).map((f) => f.key).filter((key) => !needed.has(key))
    if (unused.length) await store.delete(unused)
  }

  /**
   * Puts a backup back in place of everything. First a backup of the copy as it is now, kept
   * apart from the daily ones; then the attachments the backup lists that are missing; then
   * the database, in one transaction. The access key in use now still opens the copy, every
   * session ends, and the person who restored it gets a new one.
   */
  async restore(actor: Actor, id: string, input: unknown, userAgent: string | null) {
    this.access.requireUser(actor)
    const { accessKey } = parse(restoreBackupInput, input)
    if (!this.enabled) throw backupsOff()
    if (!/^[0-9A-Za-z-]+$/.test(id)) throw notFound('Backup')
    const owner = await this.accounts.verifyAccessKey(actor.userId, accessKey)
    return this.exclusive(async () => {
      const store = this.deps.backups!
      const sql = this.deps.sql!
      const manifest = (await this.manifests()).find((m) => m.id === id)
      const data = manifest && (await store.read(dataKey(id)))
      if (!manifest || !data) throw notFound('Backup')
      if (data.length !== manifest.data.bytes || (await sha256(data)) !== manifest.data.sha256) {
        throw new AppError(422, 'backup_damaged', 'This backup is damaged: its data is not what it was when it was made')
      }
      const migration = currentMigration(sql)
      try {
        const header = readHeader(data)
        if (Math.max(header.migration, manifest.migration) > migration) throw new DumpError('newer_version')
      } catch (error) {
        throw this.dumpError(error)
      }

      await this.create('before-restore')
      let ownerId = ''
      await this.attachments.close()
      try {
        for (const file of manifest.files) {
          if (await this.deps.storage.exists(file.key)) continue
          const body = await store.stream(fileKey(file.key))
          if (body) await this.deps.storage.put(file.key, body, file.size, 'application/octet-stream')
        }
        try {
          restoreDump(sql, data, {
            migration,
            before: () => {
              const [row] = [...sql.rows('SELECT owner_id FROM instance WHERE id = 1')]
              if (!row) throw new DumpError('cut_short')
              ownerId = String(row[0])
              // Whoever restores keeps opening the copy with the key they use now, even if the backup had another.
              sql.run('UPDATE instance SET access_key_hash = ?, setup_code_hash = ?, key_changed_at = ? WHERE id = 1', owner.accessKeyHash, owner.setupCodeHash, owner.keyChangedAt.getTime())
              sql.run('DELETE FROM sessions')
            },
          })
        } catch (error) {
          throw this.dumpError(error)
        }
        await this.deps.migrate?.()
      } finally {
        this.attachments.reopen()
      }
      this.accounts.forget()
      this.oauth.forget()
      const session = await this.accounts.startSession(ownerId, userAgent)
      return { session, restored: this.toDTO(manifest, currentMigration(sql)) }
    })
  }

  private dumpError(error: unknown) {
    if (!(error instanceof DumpError)) return error
    if (error.code === 'newer_version' || error.code === 'newer_format') {
      return new AppError(409, 'backup_newer', 'This backup was made by a newer version of Orqevio: update this copy first')
    }
    return new AppError(422, 'backup_damaged', 'This backup is damaged or incomplete')
  }
}
