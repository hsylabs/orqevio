import { type AttachmentStorage, STORAGE_KEY, WORKSPACE_ID } from '../lib/storage'

/** Attachment storage in an R2 bucket (Cloudflare). */
export class R2Storage implements AttachmentStorage {
  constructor(private readonly bucket: R2Bucket) {}

  private check(key: string) {
    if (!STORAGE_KEY.test(key)) throw new Error('Invalid storage key')
    return key
  }

  async put(key: string, body: ReadableStream<Uint8Array>, size: number, contentType: string) {
    // R2 needs the length of a streamed body up front; FixedLengthStream also
    // fails the upload if the bytes that arrive do not match it.
    const fixed = new FixedLengthStream(size)
    const [stored, piped] = await Promise.allSettled([
      this.bucket.put(this.check(key), fixed.readable, { httpMetadata: { contentType } }),
      body.pipeTo(fixed.writable),
    ])
    // A failing source (an interrupted or mismatched upload) explains the failure better than R2's own error.
    if (piped.status === 'rejected') throw piped.reason
    if (stored.status === 'rejected') throw stored.reason
  }

  async stream(key: string): Promise<ReadableStream | null> {
    const object = await this.bucket.get(this.check(key))
    return object?.body ?? null
  }

  async delete(key: string) {
    await this.bucket.delete(this.check(key))
  }

  async deleteWorkspace(workspaceId: string) {
    if (!WORKSPACE_ID.test(workspaceId)) return
    let cursor: string | undefined
    do {
      const page = await this.bucket.list({ prefix: `${workspaceId}/`, cursor })
      if (page.objects.length) await this.bucket.delete(page.objects.map((o) => o.key))
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
  }

  /** Every object of the bucket, a page (up to 1,000) at a time. */
  async deleteAll() {
    let cursor: string | undefined
    do {
      const page = await this.bucket.list({ cursor })
      if (page.objects.length) await this.bucket.delete(page.objects.map((o) => o.key))
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
  }

  async sweep(isKnown: (key: string) => Promise<boolean>, minAgeMs = 60 * 60 * 1000) {
    let removed = 0
    let cursor: string | undefined
    do {
      const page = await this.bucket.list({ cursor })
      for (const object of page.objects) {
        if (Date.now() - object.uploaded.getTime() < minAgeMs || !STORAGE_KEY.test(object.key)) continue
        if (!(await isKnown(object.key).catch(() => true))) {
          await this.bucket.delete(object.key)
          removed++
        }
      }
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
    return removed
  }
}
