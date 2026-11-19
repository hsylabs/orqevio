import { randomUUID } from 'node:crypto'
import { type AttachmentDTO, attachmentMoveInput, withoutBidiControls } from '@orqevio/shared'
import { eq, sql } from 'drizzle-orm'
import { type Actor, actorRef } from '../auth/actor'
import { attachments, cards, pages } from '../db/schema'
import { AppError, badRequest, notFound, uninstalled } from '../lib/errors'
import { LengthMismatchError, exactLength, peek } from '../lib/upload-stream'
import { parse } from '../lib/validate'
import type { Access } from './access'
import type { ActivityService } from './activity'
import type { Deps } from './deps'
import type { HistoryService } from './history'
import type { TrashService } from './trash'

/** Raster images are rendered inline; everything else (SVG included) is served as a download. */
const INLINE_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])

export const toAttachmentDTO = (a: typeof attachments.$inferSelect): AttachmentDTO => ({
  id: a.id,
  // Names stored before 1.2.1 may still hold them.
  filename: withoutBidiControls(a.filename),
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

const MAX_FILENAME = 180

/** A name safe to store and send back, at most 180 characters, keeping its extension when cut. */
export function safeFilename(name: string) {
  const cleaned = withoutBidiControls(name).replace(/[\\/\u0000-\u001f\u007f"]/g, '_').trim()
  if (cleaned.length <= MAX_FILENAME) return cleaned || 'file'
  const ext = /\.[^.\s]{1,16}$/.exec(cleaned)?.[0] ?? ''
  return cleaned.slice(0, MAX_FILENAME - ext.length).trimEnd() + ext
}

/** Detects common formats from magic bytes so the stored type does not trust the browser blindly. */
function sniff(bytes: Uint8Array, declared: string): string {
  const hex = Buffer.from(bytes.subarray(0, 12)).toString('hex')
  if (hex.startsWith('89504e47')) return 'image/png'
  if (hex.startsWith('ffd8ff')) return 'image/jpeg'
  if (hex.startsWith('47494638')) return 'image/gif'
  if (hex.startsWith('52494646') && hex.slice(16, 24) === '57454250') return 'image/webp'
  // ISO base media: `ftyp` at byte 4, then the brand (AVIF stills and sequences).
  if (hex.slice(8, 16) === '66747970' && ['61766966', '61766973'].includes(hex.slice(16, 24))) return 'image/avif'
  if (hex.startsWith('25504446')) return 'application/pdf'
  if (INLINE_IMAGES.has(declared)) return 'application/octet-stream'
  return /^[\w.+-]+\/[\w.+-]+$/.test(declared) ? declared : 'application/octet-stream'
}

function rethrowLength(error: unknown): never {
  if (error instanceof LengthMismatchError) throw new AppError(400, 'upload_incomplete', 'The upload was interrupted or did not match its size')
  throw error
}

/** The page or card whose history a file belongs to. */
const ownerOf = (row: { pageId: string | null; cardId: string | null }) =>
  row.pageId ? { entityType: 'page' as const, entityId: row.pageId } : { entityType: 'card' as const, entityId: row.cardId! }

export class AttachmentService {
  constructor(
    private readonly deps: Deps,
    private readonly access: Access,
    private readonly activity: ActivityService,
    private readonly trash: TrashService,
    private readonly history: HistoryService,
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
    this.access.requireScope(actor, target.pageId ? 'docs:write' : 'tasks:write')
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
    let row: typeof attachments.$inferSelect
    try {
      row = this.insert(actor, workspaceId, id, target, file, mimeType, storageKey)
    } catch (error) {
      // Not kept (its page or card went to the trash while it went up, say): nor is its file.
      await this.deps.storage.delete(storageKey).catch(() => {})
      throw error
    }
    await this.activity.emit(workspaceId, { action: 'attachment.created', actor: actorRef(actor), ...event })
    return toAttachmentDTO(row)
  }

  private insert(
    actor: Actor,
    workspaceId: string,
    id: string,
    target: { pageId?: string; cardId?: string },
    file: IncomingFile,
    mimeType: string,
    storageKey: string,
  ) {
    return this.deps.db.transaction((tx) => {
      // Uploading takes a while: what it goes to may be gone by now.
      const owner = target.pageId
        ? tx.select({ id: pages.id }).from(pages).where(eq(pages.id, target.pageId)).get()
        : tx.select({ id: cards.id }).from(cards).where(eq(cards.id, target.cardId!)).get()
      if (!owner) throw notFound(target.pageId ? 'Page' : 'Card')
      const row = tx
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
        .get()
      this.history.record(tx, actor, workspaceId, { ...ownerOf(row), kind: 'attachment.created', subjectId: row.id, meta: { name: row.filename } })
      return row
    })
  }

  async open(actor: Actor, attachmentId: string) {
    const [row] = await this.deps.db.select().from(attachments).where(eq(attachments.id, attachmentId))
    if (!row) throw notFound('Attachment')
    this.access.requireScope(actor, row.pageId ? 'docs:read' : 'tasks:read')
    await this.access.workspace(actor, row.workspaceId)
    const body = await this.deps.storage.stream(row.storageKey)
    if (!body) throw notFound('Attachment')
    return { meta: row, inline: INLINE_IMAGES.has(row.mimeType), body }
  }

  /** To the trash. Agents need write access to where it is, and to be allowed to delete and move. */
  async remove(actor: Actor, attachmentId: string) {
    this.access.requireScope(actor, 'organize')
    const [row] = await this.deps.db.select().from(attachments).where(eq(attachments.id, attachmentId))
    if (!row) throw notFound('Attachment')
    this.access.requireScope(actor, row.pageId ? 'docs:write' : 'tasks:write')
    await this.access.workspace(actor, row.workspaceId)
    // The file stays until the attachment leaves the trash.
    const trashId = this.deps.db.transaction((tx) => {
      const trashId = this.trash.move(tx, actor, row.workspaceId, { kind: 'attachment', id: attachmentId })
      this.history.record(tx, actor, row.workspaceId, { ...ownerOf(row), kind: 'attachment.deleted', subjectId: attachmentId, meta: { name: row.filename, trashId } })
      return trashId
    })
    await this.activity.emit(row.workspaceId, {
      action: 'attachment.deleted',
      actor: actorRef(actor),
      ...(row.pageId ? { pageId: row.pageId } : {}),
      ...(row.cardId ? { cardId: row.cardId } : {}),
    })
    return trashId
  }

  /**
   * Moves an attachment to another card or page of the same workspace. Agents need write access
   * to both places, and to be allowed to delete and move.
   */
  async move(actor: Actor, attachmentId: string, input: unknown) {
    this.access.requireScope(actor, 'organize')
    const target = parse(attachmentMoveInput, input)
    const [row] = await this.deps.db.select().from(attachments).where(eq(attachments.id, attachmentId))
    if (!row) throw notFound('Attachment')
    this.access.requireScope(actor, row.pageId ? 'docs:write' : 'tasks:write')
    this.access.requireScope(actor, target.pageId ? 'docs:write' : 'tasks:write')
    await this.access.workspace(actor, row.workspaceId)
    const to = target.pageId
      ? this.deps.db.select({ id: pages.id, title: pages.title, workspaceId: pages.workspaceId, projectId: pages.projectId }).from(pages).where(eq(pages.id, target.pageId)).get()
      : this.deps.db.select({ id: cards.id, title: cards.title, workspaceId: cards.workspaceId, boardId: cards.boardId }).from(cards).where(eq(cards.id, target.cardId!)).get()
    if (!to || to.workspaceId !== row.workspaceId) throw notFound(target.pageId ? 'Page' : 'Card')
    const before = { cardId: row.cardId, pageId: row.pageId }
    const after = { cardId: target.cardId ?? null, pageId: target.pageId ?? null }
    if (before.cardId === after.cardId && before.pageId === after.pageId) return toAttachmentDTO(row)
    const title = (place: typeof before) =>
      place.pageId
        ? (this.deps.db.select({ title: pages.title }).from(pages).where(eq(pages.id, place.pageId)).get()?.title ?? '')
        : (this.deps.db.select({ title: cards.title }).from(cards).where(eq(cards.id, place.cardId ?? '')).get()?.title ?? '')
    const moved = this.deps.db.transaction((tx) => {
      const moved = tx.update(attachments).set(after).where(eq(attachments.id, attachmentId)).returning().get()!
      // In the history of the place it left and of the one it went to.
      const change = { kind: 'attachment.moved' as const, subjectId: attachmentId, before, after, meta: { name: row.filename, from: title(before), to: title(after) } }
      this.history.record(tx, actor, row.workspaceId, { ...ownerOf(row), ...change })
      this.history.record(tx, actor, row.workspaceId, { ...ownerOf(after), ...change })
      return moved
    })
    for (const place of [row, after]) {
      const event = place.pageId ? { pageId: place.pageId } : { cardId: place.cardId! }
      await this.activity.emit(row.workspaceId, { action: 'attachment.moved', actor: actorRef(actor), ...event })
    }
    return toAttachmentDTO(moved)
  }

  /**
   * Whether an attachment or one in the trash uses a stored file. Both are checked in one
   * statement: a restore moves the file's reference from the trash back to the attachments, and
   * a check in two steps could miss it in both.
   */
  usesFile(storageKey: string) {
    return Boolean(
      this.deps.db.get(sql`SELECT 1 AS used WHERE EXISTS (SELECT 1 FROM attachments WHERE storage_key = ${storageKey})
        OR EXISTS (SELECT 1 FROM trash_rows WHERE storage_key = ${storageKey})`),
    )
  }

  /** Removes stored files that neither an attachment nor one in the trash still uses. */
  async sweepOrphans() {
    return this.deps.storage.sweep(async (key) => this.usesFile(key))
  }
}
