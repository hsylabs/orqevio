import { COMMENTS_PAGE, type CommentDTO, type CommentPageDTO, commentCreateInput, commentExcerpt, commentUpdateInput } from '@orqevio/shared'
import { and, count, desc, eq, lt, or } from 'drizzle-orm'
import { type Actor, actorRef, hasScope } from '../auth/actor'
import type { DbOrTx } from '../db/client'
import { cardComments, cards } from '../db/schema'
import { AppError, forbidden, notFound } from '../lib/errors'
import { parse } from '../lib/validate'
import type { Access } from './access'
import type { ActivityService } from './activity'
import type { Deps } from './deps'
import type { Change, HistoryService } from './history'
import type { TrashService } from './trash'

type CommentRow = typeof cardComments.$inferSelect
type CardRow = typeof cards.$inferSelect

/** Whether `actor` wrote it: a person, as themselves; an agent, with the access it uses now. */
const isAuthor = (actor: Actor, row: CommentRow) =>
  actor.kind === 'agent' ? row.authorKind === 'agent' && row.authorTokenId === actor.tokenId : row.authorKind === 'user' && row.authorUserId === actor.userId

/**
 * Comments on cards, by the person and by agents. Each author changes and deletes only their own;
 * the workspace's owner can also delete anyone's (to the trash), never change its text. An agent
 * is its access: with another one, even of the same app, it can no longer change what it wrote.
 */
export class CommentService {
  constructor(
    private readonly deps: Deps,
    private readonly access: Access,
    private readonly activity: ActivityService,
    private readonly trash: TrashService,
    private readonly history: HistoryService,
  ) {}

  /** The card, if the actor can reach it with `scope`, and whether they are its workspace's owner (a person). */
  private async card(actor: Actor, cardId: string, scope: 'tasks:read' | 'tasks:write') {
    this.access.requireScope(actor, scope)
    const [card] = await this.deps.db.select().from(cards).where(eq(cards.id, cardId))
    if (!card) throw notFound('Card')
    const role = await this.access.workspace(actor, card.workspaceId)
    return { card, owner: actor.kind === 'user' && role === 'owner' }
  }

  private async load(actor: Actor, commentId: string, scope: 'tasks:read' | 'tasks:write') {
    const [row] = await this.deps.db.select().from(cardComments).where(eq(cardComments.id, commentId))
    if (!row) throw notFound('Comment')
    // Not even that it exists, to whoever can't reach its card.
    const { card, owner } = await this.card(actor, row.cardId, scope).catch((error: unknown) => {
      throw error instanceof AppError && error.status === 404 ? notFound('Comment') : error
    })
    return { row, card, owner }
  }

  private toDTO(actor: Actor, row: CommentRow, owner: boolean): CommentDTO {
    const mine = isAuthor(actor, row)
    return {
      id: row.id,
      cardId: row.cardId,
      body: row.body,
      author: { kind: row.authorKind, id: (row.authorKind === 'agent' ? row.authorTokenId : row.authorUserId) ?? '', name: row.authorName },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      editedAt: row.editedAt?.toISOString() ?? null,
      canEdit: mine && hasScope(actor, 'tasks:write'),
      // An agent deletes only with leave to delete things, as anything else it deletes.
      canDelete: (mine && hasScope(actor, 'tasks:write') && hasScope(actor, 'organize')) || owner,
    }
  }

  /** Records a change in the card's history; run it in the transaction that makes the change. */
  private change(db: DbOrTx, actor: Actor, card: CardRow, change: Omit<Change, 'entityType' | 'entityId'>) {
    this.history.record(db, actor, card.workspaceId, { entityType: 'card', entityId: card.id, ...change })
  }

  /**
   * A card's comments, newest first, a page at a time: after the comment `beforeId`, written at
   * `before`, when given (the last of the page before). `beforeId` alone is enough.
   */
  async list(actor: Actor, cardId: string, page: { before?: Date; beforeId?: string; limit?: number } = {}): Promise<CommentPageDTO> {
    const { owner } = await this.card(actor, cardId, 'tasks:read')
    const db = this.deps.db
    const limit = Math.min(Math.max(1, Math.floor(page.limit ?? COMMENTS_PAGE)), COMMENTS_PAGE)
    let before = page.before
    if (page.beforeId && !before) {
      const [from] = await db.select({ createdAt: cardComments.createdAt }).from(cardComments).where(and(eq(cardComments.id, page.beforeId), eq(cardComments.cardId, cardId)))
      if (!from) throw notFound('Comment')
      before = from.createdAt
    }
    const after =
      before && page.beforeId
        ? or(lt(cardComments.createdAt, before), and(eq(cardComments.createdAt, before), lt(cardComments.id, page.beforeId)))
        : before
          ? lt(cardComments.createdAt, before)
          : undefined
    const [rows, [total]] = await Promise.all([
      db
        .select()
        .from(cardComments)
        .where(and(eq(cardComments.cardId, cardId), after))
        .orderBy(desc(cardComments.createdAt), desc(cardComments.id))
        .limit(limit + 1),
      db.select({ total: count() }).from(cardComments).where(eq(cardComments.cardId, cardId)),
    ])
    return { comments: rows.slice(0, limit).map((row) => this.toDTO(actor, row, owner)), total: total?.total ?? 0, hasMore: rows.length > limit }
  }

  async create(actor: Actor, cardId: string, input: unknown): Promise<CommentDTO> {
    const { body } = parse(commentCreateInput, input)
    const { card, owner } = await this.card(actor, cardId, 'tasks:write')
    const now = new Date()
    const row = this.deps.db.transaction((tx) => {
      const row = tx
        .insert(cardComments)
        .values({
          workspaceId: card.workspaceId,
          cardId,
          body,
          authorKind: actor.kind,
          authorUserId: actor.kind === 'user' ? actor.userId : null,
          authorTokenId: actor.kind === 'agent' ? actor.tokenId : null,
          authorName: actor.name,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get()
      this.change(tx, actor, card, { kind: 'comment.created', subjectId: row.id, meta: { text: commentExcerpt(body) } })
      return row
    })
    // What it says stays out of the activity, which outlives the comment once it is deleted for good.
    await this.activity.record(
      actor,
      card.workspaceId,
      { action: 'card.commented', entityType: 'card', entityId: cardId, summary: card.title, meta: { commentId: row.id } },
      { boardId: card.boardId, cardId },
    )
    return this.toDTO(actor, row, owner)
  }

  /** Changes a comment's text: only its author can, or undoing a change by the owner of the workspace. */
  async update(actor: Actor, commentId: string, input: unknown): Promise<CommentDTO> {
    const { body } = parse(commentUpdateInput, input)
    const { row, card, owner } = await this.load(actor, commentId, 'tasks:write')
    // Undoing puts back what its author had written, never new words of someone else.
    const undoing = actor.kind === 'user' && owner && actor.note?.undoOf !== undefined
    if (!isAuthor(actor, row) && !undoing) throw forbidden('Only the author of a comment can change it.', 'not_comment_author')
    if (body === row.body) return this.toDTO(actor, row, owner)
    const now = new Date()
    const updated = this.deps.db.transaction((tx) => {
      const prev = tx.select({ body: cardComments.body }).from(cardComments).where(eq(cardComments.id, commentId)).get()
      if (!prev) throw notFound('Comment')
      const updated = tx.update(cardComments).set({ body, updatedAt: now, editedAt: now }).where(eq(cardComments.id, commentId)).returning().get()!
      this.change(tx, actor, card, { kind: 'comment.body', subjectId: commentId, before: prev.body, after: body, meta: { text: commentExcerpt(body) } })
      return updated
    })
    await this.activity.emit(card.workspaceId, { action: 'card.comment_edited', actor: actorRef(actor), summary: card.title, boardId: card.boardId, cardId: card.id })
    return this.toDTO(actor, updated, owner)
  }

  /**
   * Moves a comment to the trash: its author can, an agent only with leave to delete things, and
   * the workspace's owner can delete anyone's.
   */
  async remove(actor: Actor, commentId: string) {
    this.access.requireScope(actor, 'organize')
    const { row, card, owner } = await this.load(actor, commentId, 'tasks:write')
    if (!isAuthor(actor, row) && !owner) throw forbidden("Only the author of a comment, or the workspace's owner, can delete it.", 'not_comment_author')
    const trashId = this.deps.db.transaction((tx) => {
      const trashId = this.trash.move(tx, actor, card.workspaceId, { kind: 'comment', id: commentId })
      this.change(tx, actor, card, { kind: 'comment.deleted', subjectId: commentId, meta: { text: commentExcerpt(row.body), trashId } })
      return trashId
    })
    await this.activity.emit(card.workspaceId, { action: 'card.comment_deleted', actor: actorRef(actor), summary: card.title, boardId: card.boardId, cardId: card.id })
    return trashId
  }
}
