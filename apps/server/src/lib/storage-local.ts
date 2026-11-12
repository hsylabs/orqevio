import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rm, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { type AttachmentStorage, STORAGE_KEY, WORKSPACE_ID } from './storage'

/** Attachment storage on the local filesystem (Node/Docker). */
export class LocalStorage implements AttachmentStorage {
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    if (!STORAGE_KEY.test(key)) throw new Error('Invalid storage key')
    return path.join(this.root, key)
  }

  async put(key: string, body: ReadableStream<Uint8Array>, _size: number, _contentType: string) {
    const file = this.resolve(key)
    await mkdir(path.dirname(file), { recursive: true })
    try {
      await pipeline(Readable.fromWeb(body as NodeReadableStream<Uint8Array>), createWriteStream(file, { mode: 0o600 }))
    } catch (error) {
      await unlink(file).catch(() => {})
      throw error
    }
  }

  async stream(key: string): Promise<ReadableStream | null> {
    const file = this.resolve(key)
    const info = await stat(file).catch(() => null)
    if (!info) return null
    return Readable.toWeb(createReadStream(file)) as ReadableStream
  }

  async delete(key: string) {
    await unlink(this.resolve(key)).catch(() => {})
  }

  async deleteWorkspace(workspaceId: string) {
    if (!WORKSPACE_ID.test(workspaceId)) return
    await rm(path.join(this.root, workspaceId), { recursive: true, force: true })
  }

  /** Removes files with no database row (rows cascade away when their parent is deleted). */
  async sweep(isKnown: (key: string) => Promise<boolean>, minAgeMs = 60 * 60 * 1000) {
    let removed = 0
    const dirs = await readdir(this.root).catch(() => [] as string[])
    for (const dir of dirs) {
      const files = await readdir(path.join(this.root, dir)).catch(() => [] as string[])
      for (const file of files) {
        const key = `${dir}/${file}`
        const info = await stat(path.join(this.root, key)).catch(() => null)
        if (!info || Date.now() - info.mtimeMs < minAgeMs) continue
        if (!(await isKnown(key).catch(() => true))) {
          await this.delete(key)
          removed++
        }
      }
    }
    return removed
  }
}
