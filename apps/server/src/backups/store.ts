import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import type { BackupProblemDTO } from '@orqevio/shared'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'

/**
 * Where a copy keeps its backups: a folder (Node and Docker) or a second R2 bucket (Cloudflare),
 * apart from the database and the attachments. Keys are paths made by the backup service:
 *   snapshots/<id>/data.ndjson.gz, snapshots/<id>/manifest.json   one backup
 *   files/<workspaceId>/<uuid>                                      an attachment, kept once for all of them
 */
export interface BackupStore {
  /** What the person is told: the folder, or the bucket. */
  readonly where: { kind: 'folder' | 'bucket'; name: string }
  list(prefix: string): Promise<Array<{ key: string; size: number }>>
  read(key: string): Promise<Uint8Array | null>
  /** Writes the whole file, or nothing. */
  write(key: string, data: Uint8Array): Promise<void>
  stream(key: string): Promise<ReadableStream<Uint8Array> | null>
  /** Streams exactly `size` bytes into `key`, or keeps nothing. */
  writeStream(key: string, body: ReadableStream<Uint8Array>, size: number): Promise<void>
  delete(keys: string[]): Promise<void>
  /** Why backups can't be made or read there, if so: a folder that isn't the app's, read-only, or full. */
  check?(): Promise<BackupProblemDTO | null>
  /** Whether a failed file operation was about this folder, not about the copy's own files being read. */
  failedHere?(error: unknown): boolean
}

/** What a failed file operation means for backups, and where. */
export function problemOf(error: unknown, at: string): BackupProblemDTO {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  const uid = typeof process !== 'undefined' ? process.getuid?.() : undefined
  const gid = typeof process !== 'undefined' ? process.getgid?.() : undefined
  return {
    code: code === 'EACCES' || code === 'EPERM' ? 'access' : code === 'EROFS' ? 'readonly' : code === 'ENOSPC' || code === 'EDQUOT' ? 'full' : 'other',
    path: at,
    user: uid === undefined ? null : `${uid}:${gid ?? uid}`,
    detail: error instanceof Error ? error.message : String(error),
  }
}

/** A file operation that failed because of the folder itself (its owner, read-only, full), not the backup. */
export const isFolderError = (error: unknown) => ['EACCES', 'EPERM', 'EROFS', 'ENOSPC', 'EDQUOT'].includes((error as NodeJS.ErrnoException | undefined)?.code ?? '')

/** For the server's log: what is wrong, and what to do. `root` is the backups folder. */
export function describeBackupProblem(problem: BackupProblemDTO, root = problem.path) {
  switch (problem.code) {
    case 'access':
      return `Backups can't be made: this server's user (${problem.user ?? 'unknown'}) can't read or write ${problem.path}. Give the backups folder back to that user: mounted from the host, with sudo chown -R ${problem.user ?? '100:101'} on it; inside the volume (backups copied in with docker compose cp are left to root), with docker compose run --rm --user root app chown -R orqevio:orqevio ${root}.`
    case 'readonly':
      return `Backups can't be made: ${problem.path} is read-only.`
    case 'full':
      return `Backups can't be made: the disk of ${problem.path} is full.`
    default:
      return `Backups can't be made in ${problem.path}: ${problem.detail}`
  }
}

export const BACKUP_KEY = /^(?:snapshots\/[0-9A-Za-z-]+\/(?:data\.ndjson\.gz|manifest\.json)|files\/[0-9a-f-]{36}\/[0-9a-f-]{36})$/

function checked(key: string) {
  if (!BACKUP_KEY.test(key)) throw new Error('Invalid backup key')
  return key
}

// Backups hold everything the copy holds: like the attachments, only the server's user reads them.
const PRIVATE_DIR = 0o700
const PRIVATE_FILE = 0o600
/** The folders backups are written in: snapshots/<id>/ and files/<workspaceId>/. Nothing else there is read. */
const LAYOUT = /^(?:snapshots|files)\/(?:[^/]+\/)?$/
/** Made and removed to check a folder can be written; not empty, since a full disk still takes an empty file. */
const PROBE = '.orqevio-check'
const PROBE_BYTES = new Uint8Array(64 * 1024)

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'

/** Backups in a folder (BACKUP_DIR), written next to their final name and then renamed into place. */
export class FolderBackupStore implements BackupStore {
  readonly where: BackupStore['where']

  constructor(private readonly root: string) {
    this.where = { kind: 'folder', name: root }
  }

  private file(key: string) {
    return path.join(this.root, ...checked(key).split('/'))
  }

  /**
   * What is under `prefix`, reading only its own folder: another folder in the backups folder (a
   * disk's lost+found, say) is not the app's. A folder that can't be read is said, not taken for
   * an empty one: backups there would look gone.
   */
  async list(prefix: string) {
    const found: Array<{ key: string; size: number }> = []
    const walk = async (dir: string, key: string): Promise<void> => {
      let entries: import('node:fs').Dirent[]
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch (error) {
        if (isMissing(error)) return
        throw error
      }
      for (const entry of entries) {
        const child = `${key}${entry.name}`
        if (entry.isDirectory()) {
          if (LAYOUT.test(`${child}/`) && (`${child}/`.startsWith(prefix) || prefix.startsWith(`${child}/`))) await walk(path.join(dir, entry.name), `${child}/`)
        } else if (entry.isFile() && child.startsWith(prefix) && BACKUP_KEY.test(child)) {
          const info = await stat(path.join(dir, entry.name)).catch((error) => {
            if (isMissing(error)) return null
            throw error
          })
          if (info) found.push({ key: child, size: info.size })
        }
      }
    }
    await walk(this.root, '')
    return found
  }

  /**
   * The folder, and the folders backups are written in, must be the app's to read and write:
   * backups are written there, and old ones removed. A file is made and removed in each, to be sure.
   */
  async check() {
    try {
      await mkdir(this.root, { recursive: true, mode: PRIVATE_DIR })
    } catch (error) {
      return problemOf(error, this.root)
    }
    const dirs = [this.root]
    for (const top of ['snapshots', 'files']) {
      const dir = path.join(this.root, top)
      try {
        const entries = await readdir(dir, { withFileTypes: true })
        dirs.push(dir, ...entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(dir, entry.name)))
      } catch (error) {
        // Not there yet: the first backup makes it.
        if (isMissing(error)) continue
        return problemOf(error, dir)
      }
    }
    for (const dir of dirs) {
      const probe = path.join(dir, PROBE)
      try {
        await writeFile(probe, dir === this.root ? PROBE_BYTES : '', { mode: PRIVATE_FILE })
        await rm(probe, { force: true })
      } catch (error) {
        await rm(probe, { force: true }).catch(() => {})
        return problemOf(error, dir)
      }
    }
    return null
  }

  /** A failed operation in this folder: one whose path is in it, or a write with no path (a full disk). */
  failedHere(error: unknown) {
    const e = error as NodeJS.ErrnoException | undefined
    if (!e?.path) return isFolderError(e)
    const inside = path.relative(this.root, e.path)
    return typeof e.syscall === 'string' && inside !== '..' && !inside.startsWith(`..${path.sep}`) && !path.isAbsolute(inside)
  }

  async read(key: string) {
    try {
      return new Uint8Array(await readFile(this.file(key)))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async write(key: string, data: Uint8Array) {
    const file = this.file(key)
    await mkdir(path.dirname(file), { recursive: true, mode: PRIVATE_DIR })
    const partial = `${file}.partial`
    await writeFile(partial, data, { mode: PRIVATE_FILE })
    await rename(partial, file)
  }

  async stream(key: string) {
    const file = this.file(key)
    try {
      await stat(file)
    } catch {
      return null
    }
    return Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>
  }

  async writeStream(key: string, body: ReadableStream<Uint8Array>, size: number) {
    const file = this.file(key)
    await mkdir(path.dirname(file), { recursive: true, mode: PRIVATE_DIR })
    const partial = `${file}.partial`
    let written = 0
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        written += chunk.length
        controller.enqueue(chunk)
      },
    })
    try {
      await body.pipeThrough(counter).pipeTo(Writable.toWeb(createWriteStream(partial, { mode: PRIVATE_FILE })))
      if (written !== size) throw new Error(`Expected ${size} bytes, got ${written}`)
      await rename(partial, file)
    } catch (error) {
      await rm(partial, { force: true })
      throw error
    }
  }

  async delete(keys: string[]) {
    for (const key of keys) await rm(this.file(key), { force: true })
    // Empty snapshot folders go too.
    const snapshots = path.join(this.root, 'snapshots')
    const folders = await readdir(snapshots).catch(() => [] as string[])
    for (const folder of folders) {
      const dir = path.join(snapshots, folder)
      if (!(await readdir(dir).catch(() => ['?'])).length) await rm(dir, { recursive: true, force: true })
    }
  }
}

/** Removes every backup and every attachment kept for them (uninstalling with "delete the backups too"). */
export async function emptyBackupStore(store: BackupStore) {
  // Manifests first: a backup half-deleted is never listed.
  const snapshots = (await store.list('snapshots/')).map((k) => k.key)
  const manifests = snapshots.filter((key) => key.endsWith('/manifest.json'))
  if (manifests.length) await store.delete(manifests)
  const rest = [...snapshots.filter((key) => !key.endsWith('/manifest.json')), ...(await store.list('files/')).map((k) => k.key)]
  if (rest.length) await store.delete(rest)
}
