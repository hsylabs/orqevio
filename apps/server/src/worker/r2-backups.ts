import { BACKUP_KEY, type BackupStore } from '../backups/store'

function checked(key: string) {
  if (!BACKUP_KEY.test(key)) throw new Error('Invalid backup key')
  return key
}

/** Backups in the copy's second R2 bucket (BACKUPS), apart from the attachments. */
export class R2BackupStore implements BackupStore {
  readonly where: BackupStore['where']

  constructor(
    private readonly bucket: R2Bucket,
    name: string,
  ) {
    this.where = { kind: 'bucket', name }
  }

  async list(prefix: string) {
    const found: Array<{ key: string; size: number }> = []
    let cursor: string | undefined
    do {
      const page = await this.bucket.list({ prefix, cursor })
      for (const object of page.objects) if (BACKUP_KEY.test(object.key)) found.push({ key: object.key, size: object.size })
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
    return found
  }

  async read(key: string) {
    const object = await this.bucket.get(checked(key))
    return object ? new Uint8Array(await object.arrayBuffer()) : null
  }

  async write(key: string, data: Uint8Array) {
    await this.bucket.put(checked(key), data)
  }

  async stream(key: string) {
    const object = await this.bucket.get(checked(key))
    return (object?.body as ReadableStream<Uint8Array> | undefined) ?? null
  }

  async writeStream(key: string, body: ReadableStream<Uint8Array>, size: number) {
    // R2 needs the length up front; FixedLengthStream also fails the upload if it doesn't match.
    const fixed = new FixedLengthStream(size)
    const [stored, piped] = await Promise.allSettled([this.bucket.put(checked(key), fixed.readable), body.pipeTo(fixed.writable)])
    if (piped.status === 'rejected') throw piped.reason
    if (stored.status === 'rejected') throw stored.reason
  }

  async delete(keys: string[]) {
    for (let i = 0; i < keys.length; i += 1000) await this.bucket.delete(keys.slice(i, i + 1000).map(checked))
  }
}
