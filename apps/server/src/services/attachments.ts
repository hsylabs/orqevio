import { randomUUID } from 'node:crypto'
import type { AttachmentDTO } from '@orqevio/shared'
import { eq } from 'drizzle-orm'
import type { Actor } from '../auth/actor'
import { attachments, cards, pages } from '../db/schema'
import { AppError, badRequest, notFound, uninstalled } from '../lib/errors'
import { LengthMismatchError, exactLength, peek } from '../lib/upload-stream'
import type { Access } from './access'
import type { ActivityService } from './activity'
import type { Deps } from './deps'

/** Raster images are rendered inline; everything else (SVG included) is served as a download. */
const INLINE_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])

export const toAttachmentDTO = (a: typeof attachments.$inferSelect): AttachmentDTO => ({
  id: a.id,
  filename: a.filename,
  mimeType: a.mimeType,
  size: a.size,
  url: `/api/attachments/${a.id}`,
  isImage: INLINE_IMAGES.has(a.mimeType),
  createdAt: a.createdAt.toISOString(),
})

/** A file sent as the raw request body. */
export interface IncomingFile {
  body: ReadableStream<Uint8Array> | null
  /** Content-Length; NaN when the client did not send it. */
  size: number
  name: string
  type: string
}

function safeFilename(name: string) {
  const cleaned = name.replace(/[\\/\u0000-\u001f\u007f"]/g, '_').trim().slice(0, 180)
  return cleaned || 'file'
}

/** Detects common formats from magic bytes so the stored type does not trust the browser blindly. */
function sniff(bytes: Uint8Array, declared: string): string {
  const hex = Buffer.from(bytes.subarray(0, 12)).toString('hex')
  if (hex.startsWith('89504e47')) return 'image/png'
  if (hex.startsWith('ffd8ff')) return 'image/jpeg'
  if (hex.startsWith('47494638')) return 'image/gif'
  if (hex.startsWith('52494646') && hex.slice(16, 24) === '57454250') return 'image/webp'
  if (hex.startsWith('25504446')) return 'application/pdf'
  if (INLINE_IMAGES.has(declared)) return 'application/octet-stream'
  return /^[\w.+-]+\/[\w.+-]+$/.test(declared) ? declared : 'application/octet-stream'
}

function rethrowLength(error: unknown): never {
  if (error instanceof LengthMismatchError) throw new AppError(400, 'upload_incomplete', 'The upload was interrupted or did not match its size')
  throw error
}

export class AttachmentService {
  constructor(
    private readonly deps: Deps,
    private readonly access: Access,
    private readonly activity: ActivityService,
  ) {}

  /**
   * Streams the file straight to storage: memory and CPU stay flat whatever its
   * size, which matters on Cloudflare (128 MB per copy, CPU billed per request).
   */
  /** Uploads still running, which uninstalling waits for (see close). */
  private readonly inFlight = new Set<Promise<unknown>>()
  private closed = false

  async upload(actor: Actor, target: { pageId?: string; cardId?: string }, file: IncomingFile): Promise<AttachmentDTO> {
    if (this.closed) throw uninstalled()
    const work = this.store(actor, target, file)
    this.inFlight.add(work)
    try {
      return await work
    } finally {
      this.inFlight.delete(work)
    }
  }

  /**
   * Refuses new uploads and waits for the running ones, so that deleting every stored
   * file afterwards cannot miss one still being written. reopen() undoes it.
   */
  async close() {
    this.closed = true
    await Promise.allSettled([...this.inFlight])
  }

  reopen() {
    this.closed = false
  }

  private async store(actor: Actor, target: { pageId?: string; cardId?: string }, file: IncomingFile): Promise<AttachmentDTO> {
    this.access.requireUser(actor)
    if (/^multipart\/form-data/i.test(file.type)) {
      throw new AppError(415, 'raw_upload_required', 'Send the file itself as the request body, with its name in the X-File-Name header')
    }
    if (!Number.isSafeInteger(file.size) || file.size < 0) throw new AppError(411, 'length_required', 'Content-Length is required')
    if (file.size === 0 || !file.body) throw badRequest('The file is empty')
    if (file.size > this.deps.env.maxUploadBytes) {
      throw new AppError(413, 'file_too_large', `Files are limited to ${Math.round(this.deps.env.maxUploadBytes / 1048576)} MB`)
    }
    let workspaceId: string
    let event: { pageId?: string; cardId?: string; boardId?: string; projectId?: string }
    if (target.pageId) {
      const [page] = await this.deps.db.select().from(pages).where(eq(pages.id, target.pageId))
      if (!page) throw notFound('Page')
      await this.access.workspace(actor, page.workspaceId)
      workspaceId = page.workspaceId
      event = { pageId: page.id, projectId: page.projectId }
    } else if (target.cardId) {
      const [card] = await this.deps.db.select().from(cards).where(eq(cards.id, target.cardId))
      if (!card) throw notFound('Card')
      await this.access.workspace(actor, card.workspaceId)
      workspaceId = card.workspaceId
      event = { cardId: card.id, boardId: card.boardId }
    } else {
      throw badRequest('pageId or cardId is required')
    }
    const id = randomUUID()
    const storageKey = `${workspaceId}/${id}`
    const { head, stream } = await peek(file.body.pipeThrough(exactLength(file.size)), 12).catch(rethrowLength)
    const mimeType = sniff(head, file.type.split(';')[0]!.trim().toLowerCase())
    await this.deps.storage.put(storageKey, stream, file.size, mimeType).catch(rethrowLength)
    const [row] = await this.deps.db
      .insert(attachments)
      .values({
        id,
        workspaceId,
        pageId: target.pageId ?? null,
        cardId: target.pageId ? null : (target.cardId ?? null),
        filename: safeFilename(file.name),
        mimeType,
        size: file.size,
        storageKey,
        createdByUserId: actor.userId,
      })
      .returning()
    await this.activity.emit(workspaceId, { action: 'attachment.created', actor: { kind: 'user', id: actor.userId, name: actor.name }, ...event })
    return toAttachmentDTO(row!)
  }

  async open(actor: Actor, attachmentId: string) {
    this.access.requireUser(actor)
    const [row] = await this.deps.db.select().from(attachments).where(eq(attachments.id, attachmentId))
    if (!row) throw notFound('Attachment')
    await this.access.workspace(actor, row.workspaceId)
    const body = await this.deps.storage.stream(row.storageKey)
    if (!body) throw notFound('Attachment')
    return { meta: row, inline: INLINE_IMAGES.has(row.mimeType), body }
  }

  async remove(actor: Actor, attachmentId: string) {
    this.access.requireUser(actor)
    const [row] = await this.deps.db.select().from(attachments).where(eq(attachments.id, attachmentId))
    if (!row) throw notFound('Attachment')
    await this.access.workspace(actor, row.workspaceId)
    await this.deps.db.delete(attachments).where(eq(attachments.id, attachmentId))
    await this.deps.storage.delete(row.storageKey)
    await this.activity.emit(row.workspaceId, {
      action: 'attachment.deleted',
      actor: { kind: 'user', id: actor.userId, name: actor.name },
      ...(row.pageId ? { pageId: row.pageId } : {}),
      ...(row.cardId ? { cardId: row.cardId } : {}),
    })
  }

  async sweepOrphans() {
    return this.deps.storage.sweep(async (key) => {
      const [row] = await this.deps.db.select({ id: attachments.id }).from(attachments).where(eq(attachments.storageKey, key)).limit(1)
      return Boolean(row)
    })
  }
}
