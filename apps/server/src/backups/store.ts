import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
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
}

export const BACKUP_KEY = /^(?:snapshots\/[0-9A-Za-z-]+\/(?:data\.ndjson\.gz|manifest\.json)|files\/[0-9a-f-]{36}\/[0-9a-f-]{36})$/

function checked(key: string) {
  if (!BACKUP_KEY.test(key)) throw new Error('Invalid backup key')
  return key
}

/** Backups in a folder (BACKUP_DIR), written next to their final name and then renamed into place. */
export class FolderBackupStore implements BackupStore {
  readonly where: BackupStore['where']

  constructor(private readonly root: string) {
    this.where = { kind: 'folder', name: root }
  }

  private file(key: string) {
    return path.join(this.root, ...checked(key).split('/'))
  }

  async list(prefix: string) {
    const found: Array<{ key: string; size: number }> = []
    const walk = async (dir: string, key: string): Promise<void> => {
      let entries: import('node:fs').Dirent[]
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const child = key ? `${key}/${entry.name}` : entry.name
        if (entry.isDirectory()) await walk(path.join(dir, entry.name), child)
        else if (entry.isFile() && child.startsWith(prefix) && BACKUP_KEY.test(child)) found.push({ key: child, size: (await stat(path.join(dir, entry.name))).size })
      }
    }
    await walk(this.root, '')
    return found
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
    await mkdir(path.dirname(file), { recursive: true })
    const partial = `${file}.partial`
    await writeFile(partial, data)
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
    await mkdir(path.dirname(file), { recursive: true })
    const partial = `${file}.partial`
    let written = 0
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        written += chunk.length
        controller.enqueue(chunk)
      },
    })
    try {
      await body.pipeThrough(counter).pipeTo(Writable.toWeb(createWriteStream(partial)))
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
