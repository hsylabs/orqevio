import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { type AttachmentStorage, STORAGE_KEY, WORKSPACE_ID } from './storage'
import { exactLength } from './upload-stream'

/** What a file is called while it is being written. */
const PARTIAL = '.partial'

/** Attachment storage on the local filesystem (Node/Docker). */
export class LocalStorage implements AttachmentStorage {
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    if (!STORAGE_KEY.test(key)) throw new Error('Invalid storage key')
    return path.join(this.root, key)
  }

  /**
   * Keeps exactly `size` bytes, or nothing: like R2, a body cut short or longer fails. Written next
   * to its place and then moved there, so a file stopped half-way is never taken for a whole one.
   */
  async put(key: string, body: ReadableStream<Uint8Array>, size: number, _contentType: string) {
    const file = this.resolve(key)
    await mkdir(path.dirname(file), { recursive: true })
    const partial = `${file}${PARTIAL}`
    try {
      await pipeline(Readable.fromWeb(body.pipeThrough(exactLength(size)) as NodeReadableStream<Uint8Array>), createWriteStream(partial, { mode: 0o600 }))
      await rename(partial, file)
    } catch (error) {
      await unlink(partial).catch(() => {})
      throw error
    }
  }

  async stream(key: string): Promise<ReadableStream | null> {
    const file = this.resolve(key)
    const info = await stat(file).catch(() => null)
    if (!info) return null
    return Readable.toWeb(createReadStream(file)) as ReadableStream
  }

  async exists(key: string) {
    return Boolean(await stat(this.resolve(key)).catch(() => null))
  }

  async delete(key: string) {
    await unlink(this.resolve(key)).catch(() => {})
  }

  async deleteWorkspace(workspaceId: string) {
    if (!WORKSPACE_ID.test(workspaceId)) return
    await rm(path.join(this.root, workspaceId), { recursive: true, force: true })
  }

  async deleteAll() {
    const entries = await readdir(this.root).catch(() => [] as string[])
    for (const entry of entries) await rm(path.join(this.root, entry), { recursive: true, force: true })
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
        // Left by a write that stopped half-way.
        if (file.endsWith(PARTIAL)) {
          await unlink(path.join(this.root, key)).catch(() => {})
          continue
        }
        // Not an attachment of the app's: left as it is.
        if (!STORAGE_KEY.test(key)) continue
        if (!(await isKnown(key).catch(() => true))) {
          await this.delete(key)
          removed++
        }
      }
    }
    return removed
  }
}
