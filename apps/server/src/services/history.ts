import {
  HISTORY_BODY_KINDS,
  HISTORY_DAYS,
  HISTORY_TEXT_KINDS,
  type HistoryEntryDTO,
  type HistoryKind,
  type HistoryMeta,
  type HistoryValue,
  lineStats,
} from '@orqevio/shared'
import { and, desc, eq, getTableColumns, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'
import type { Actor } from '../auth/actor'
import type { DbOrTx } from '../db/client'
import { cards, history, pages } from '../db/schema'
import { notFound } from '../lib/errors'
import type { Access } from './access'
import type { Deps } from './deps'

/**
 * A stretch of work: edits of the same text by the same person within it are one change,
 * and everything one person or agent changes within it shares a batch.
 */
const STRETCH_MS = 10 * 60 * 1000
const DAY_MS = 86_400_000

export interface Change {
  entityType: 'page' | 'card'
  entityId: string
  kind: HistoryKind
  subjectId?: string | null
  before?: HistoryValue
  after?: HistoryValue
  meta?: HistoryMeta
}

/** Kinds that only say something happened: they carry no value before or after. */
const MARK = /\.(created|deleted|restored|linked|unlinked)$/

type Row = typeof history.$inferSelect

/** A list's columns: long texts read as null, so listing never loads them. */
const LIST_COLUMNS = (() => {
  const body = inArray(history.kind, [...HISTORY_BODY_KINDS])
  return {
    ...getTableColumns(history),
    before: sql<string | null>`CASE WHEN ${body} THEN NULL ELSE ${history.before} END`,
    after: sql<string | null>`CASE WHEN ${body} THEN NULL ELSE ${history.after} END`,
  }
})()

const encode = (kind: HistoryKind, value: HistoryValue | undefined) =>
  value === null || value === undefined ? null : HISTORY_TEXT_KINDS.has(kind) ? String(value) : JSON.stringify(value)
const decode = (kind: HistoryKind, raw: string | null): HistoryValue =>
  raw === null ? null : HISTORY_TEXT_KINDS.has(kind) ? raw : (JSON.parse(raw) as HistoryValue)

/** Line counts of a long text's change, for lists that leave the texts out. */
const bodyMeta = (kind: HistoryKind, before: string | null, after: string | null): HistoryMeta => {
  if (!HISTORY_BODY_KINDS.has(kind)) return {}
  const { added, removed } = lineStats(before ?? '', after ?? '')
  return { linesAdded: added, linesRemoved: removed }
}

export function toHistoryEntryDTO(row: Row, withBodies: boolean): HistoryEntryDTO {
  const hidden = !withBodies && HISTORY_BODY_KINDS.has(row.kind)
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    kind: row.kind,
    subjectId: row.subjectId,
    before: hidden ? null : decode(row.kind, row.before),
    after: hidden ? null : decode(row.kind, row.after),
    meta: row.meta,
    actor: { kind: row.actorKind, id: (row.actorKind === 'agent' ? row.actorTokenId : row.actorUserId) ?? '', name: row.actorName },
    batchId: row.batchId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export class HistoryService {
  constructor(
    private readonly deps: Deps,
    private readonly access: Access,
  ) {}

  /**
   * Records a change. Synchronous, to run in the transaction that makes it: the value before
   * is read there, and the change and its record are saved together or not at all.
   */
  record(db: DbOrTx, actor: Actor, workspaceId: string, change: Change, now = new Date()) {
    const kind = change.kind
    const before = encode(kind, change.before)
    const after = encode(kind, change.after)
    if (!MARK.test(kind) && before === after) return
    const subject = change.subjectId ?? null
    // A person editing a text keeps one change per stretch of work, as the editor saves while they type.
    if (actor.kind === 'user' && HISTORY_TEXT_KINDS.has(kind)) {
      const last = db
        .select()
        .from(history)
        .where(and(eq(history.entityId, change.entityId), eq(history.kind, kind), subject ? eq(history.subjectId, subject) : isNull(history.subjectId)))
        .orderBy(desc(history.updatedAt), desc(sql`rowid`))
        .limit(1)
        .get()
      if (last && last.actorKind === 'user' && last.actorUserId === actor.userId && last.updatedAt.getTime() > now.getTime() - STRETCH_MS) {
        // Typed back to where the stretch began: nothing changed after all.
        if (last.before === after) db.delete(history).where(eq(history.id, last.id)).run()
        else
          db.update(history)
            .set({ after, meta: { ...last.meta, ...change.meta, ...bodyMeta(kind, last.before, after) }, updatedAt: now })
            .where(eq(history.id, last.id))
            .run()
        return
      }
    }
    const recent = db
      .select({ batchId: history.batchId })
      .from(history)
      .where(
        and(
          actor.kind === 'agent' ? eq(history.actorTokenId, actor.tokenId) : and(eq(history.actorUserId, actor.userId), eq(history.actorKind, 'user')),
          eq(history.workspaceId, workspaceId),
          gt(history.updatedAt, new Date(now.getTime() - STRETCH_MS)),
        ),
      )
      .orderBy(desc(history.updatedAt))
      .limit(1)
      .get()
    db.insert(history)
      .values({
        workspaceId,
        entityType: change.entityType,
        entityId: change.entityId,
        kind,
        subjectId: subject,
        before,
        after,
        meta: { ...change.meta, ...bodyMeta(kind, before, after) },
        actorKind: actor.kind,
        actorUserId: actor.userId,
        actorTokenId: actor.kind === 'agent' ? actor.tokenId : null,
        actorName: actor.name,
        batchId: recent?.batchId ?? crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      })
      .run()
  }

  /** Checks the actor can read the page or card, which must exist (not in the trash). */
  private async entity(actor: Actor, entityType: 'page' | 'card', entityId: string) {
    this.access.requireScope(actor, entityType === 'page' ? 'docs:read' : 'tasks:read')
    const table = entityType === 'page' ? pages : cards
    const [row] = await this.deps.db.select({ workspaceId: table.workspaceId }).from(table).where(eq(table.id, entityId))
    if (!row) throw notFound(entityType === 'page' ? 'Page' : 'Card')
    await this.access.workspace(actor, row.workspaceId)
  }

  /**
   * The changes of a page or a card, newest first, after the entry `beforeId` (updated at
   * `before`) of the previous page. Long texts are left out, not even read; `get` has them.
   */
  async list(actor: Actor, entityType: 'page' | 'card', entityId: string, opts: { before?: Date; beforeId?: string; limit?: number } = {}) {
    await this.entity(actor, entityType, entityId)
    const rows = await this.deps.db
      .select(LIST_COLUMNS)
      .from(history)
      .where(and(eq(history.entityId, entityId), eq(history.entityType, entityType), this.after(opts.before, opts.beforeId)))
      .orderBy(desc(history.updatedAt), desc(sql`rowid`))
      .limit(Math.min(opts.limit ?? 50, 100))
    return rows.map((row) => toHistoryEntryDTO(row, false))
  }

  /**
   * Where the next page starts: after the last entry of the previous one, in the list's order.
   * Several changes can share a millisecond, so the entry itself breaks the tie. If it changed
   * since (merged with a later edit, or gone), the time alone is the best there is.
   */
  private after(before: Date | undefined, beforeId: string | undefined) {
    if (!before) return undefined
    const anchor = beforeId
      ? this.deps.db.get<{ seq: number }>(sql`SELECT rowid AS seq FROM history WHERE id = ${beforeId} AND updated_at = ${before.getTime()}`)
      : undefined
    if (!anchor) return lt(history.updatedAt, before)
    return or(lt(history.updatedAt, before), and(eq(history.updatedAt, before), sql`rowid < ${anchor.seq}`))
  }

  /** One change, with its texts before and after. */
  async get(actor: Actor, entryId: string) {
    const [row] = await this.deps.db.select().from(history).where(eq(history.id, entryId))
    if (!row) throw notFound('History entry')
    await this.entity(actor, row.entityType, row.entityId)
    return toHistoryEntryDTO(row, true)
  }

  /**
   * Forgets the history of what a trash entry holds, as it is deleted for good: the pages and
   * cards in it, and the checklists, items and files it took from a card or a page.
   */
  forget(db: DbOrTx, trashId: string) {
    const ids = sql`SELECT json_extract(data, '$.id') FROM trash_rows WHERE trash_id = ${trashId}`
    db.delete(history)
      .where(or(sql`${history.entityId} IN (${ids})`, sql`${history.subjectId} IN (${ids})`))
      .run()
  }

  /** Deletes what has been in the history for HISTORY_DAYS. Runs hourly. */
  async purgeExpired(now = new Date()) {
    const removed = await this.deps.db
      .delete(history)
      .where(lte(history.updatedAt, new Date(now.getTime() - HISTORY_DAYS * DAY_MS)))
      .returning({ id: history.id })
    return removed.length
  }
}
