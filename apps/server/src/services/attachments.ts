import { randomUUID } from 'node:crypto'
import type { AttachmentDTO } from '@orqevio/shared'
import { eq } from 'drizzle-orm'
import type { Actor } from '../auth/actor'
import { attachments, cards, pages } from '../db/schema'
import { AppError, badRequest, notFound } from '../lib/errors'
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

export class AttachmentService {
  constructor(
    private readonly deps: Deps,
    private readonly access: Access,
    private readonly activity: ActivityService,
  ) {}

  async upload(actor: Actor, target: { pageId?: string; cardId?: string }, file: File): Promise<AttachmentDTO> {
    this.access.requireUser(actor)
    if (!file || typeof file.arrayBuffer !== 'function') throw badRequest('A file is required')
    if (file.size === 0) throw badRequest('The file is empty')
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
    const bytes = new Uint8Array(await file.arrayBuffer())
    const id = randomUUID()
    const storageKey = `${workspaceId}/${id}`
    await this.deps.storage.put(storageKey, bytes)
    const [row] = await this.deps.db
      .insert(attachments)
      .values({
        id,
        workspaceId,
        pageId: target.pageId ?? null,
        cardId: target.pageId ? null : (target.cardId ?? null),
        filename: safeFilename(file.name),
        mimeType: sniff(bytes, file.type),
        size: bytes.byteLength,
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
    return { meta: row, inline: INLINE_IMAGES.has(row.mimeType), body: this.deps.storage.stream(row.storageKey) }
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
