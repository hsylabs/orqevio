import type { ActivityDTO, EntityType, RealtimeEvent } from '@orqevio/shared'
import { and, desc, eq, gt, lt, or, sql } from 'drizzle-orm'
import type { Actor } from '../auth/actor'
import { actorRef } from '../auth/actor'
import { activity } from '../db/schema'
import type { DbOrTx } from '../db/client'
import type { Deps } from './deps'

type Meta = Record<string, string | number | boolean | null>

export interface ActivityEntry {
  action: string
  entityType: EntityType
  entityId: string
  summary: string
  meta?: Meta
  /** Repeated edits by the same actor within this window update one row instead of adding new ones. */
  coalesce?: boolean
}

const COALESCE_MS = 10 * 60 * 1000

/**
 * The details of edits folded into one entry: the latest values, except `fields`, which lists
 * every field edited since the entry was made, not only the last edit's.
 */
function mergeMeta(before: Meta, after: Meta): Meta {
  const merged = { ...before, ...after }
  if (typeof before.fields === 'string' && typeof after.fields === 'string') {
    merged.fields = [...new Set([...before.fields.split(','), ...after.fields.split(',')].filter(Boolean))].join(',')
  }
  return merged
}

export function toActivityDTO(row: typeof activity.$inferSelect): ActivityDTO {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType as EntityType,
    entityId: row.entityId,
    summary: row.summary,
    actor: {
      kind: row.actorKind,
      id: (row.actorKind === 'agent' ? row.actorTokenId : row.actorUserId) ?? '',
      name: row.actorName,
    },
    meta: row.meta,
    createdAt: row.createdAt.toISOString(),
  }
}

export class ActivityService {
  constructor(private readonly deps: Deps) {}

  /** Stores an audit entry and notifies connected clients. */
  async record(
    actor: Actor,
    workspaceId: string,
    entry: ActivityEntry,
    event: Omit<RealtimeEvent, 'action' | 'actor' | 'summary'> = {},
    db: DbOrTx = this.deps.db,
  ) {
    const actorFilter =
      actor.kind === 'agent' ? eq(activity.actorTokenId, actor.tokenId) : eq(activity.actorUserId, actor.userId)
    // Read and written with nothing in between, so that two edits at once can't each merge into
    // the same old entry and lose the other's fields.
    const recent = entry.coalesce
      ? db
          .select({ id: activity.id, meta: activity.meta })
          .from(activity)
          .where(
            and(
              eq(activity.entityId, entry.entityId),
              eq(activity.action, entry.action),
              eq(activity.actorKind, actor.kind),
              actorFilter,
              gt(activity.createdAt, new Date(Date.now() - COALESCE_MS)),
            ),
          )
          .orderBy(desc(activity.createdAt), desc(sql`rowid`))
          .limit(1)
          .get()
      : undefined
    if (recent) {
      db.update(activity)
        .set({ createdAt: new Date(), summary: entry.summary.slice(0, 300), meta: mergeMeta(recent.meta as Meta, entry.meta ?? {}) })
        .where(eq(activity.id, recent.id))
        .run()
    } else {
      await db.insert(activity).values({
        workspaceId,
        actorKind: actor.kind,
        actorUserId: actor.userId,
        actorTokenId: actor.kind === 'agent' ? actor.tokenId : null,
        actorName: actor.name,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        summary: entry.summary.slice(0, 300),
        meta: entry.meta ?? {},
      })
    }
    await this.emit(workspaceId, { ...event, action: entry.action, actor: actorRef(actor), summary: entry.summary })
  }

  async emit(workspaceId: string, event: RealtimeEvent) {
    try {
      await this.deps.bus.publish(workspaceId, event)
    } catch (error) {
      console.error('[realtime] publish failed', error)
    }
  }

  /**
   * The workspace's activity, newest first. A page after the first starts after the last entry
   * of the previous one: `before`, its time, and `beforeId`, the entry itself, as several can
   * share a millisecond.
   */
  async list(workspaceId: string, opts: { limit?: number; before?: Date; beforeId?: string; entityId?: string; tokenId?: string; agentsOnly?: boolean } = {}) {
    const filters = [eq(activity.workspaceId, workspaceId)]
    const after = this.after(opts.before, opts.beforeId)
    if (after) filters.push(after)
    if (opts.entityId) filters.push(eq(activity.entityId, opts.entityId))
    if (opts.tokenId) filters.push(eq(activity.actorTokenId, opts.tokenId))
    if (opts.agentsOnly) filters.push(eq(activity.actorKind, 'agent'))
    const rows = await this.deps.db
      .select()
      .from(activity)
      .where(and(...filters))
      // Timestamps have millisecond precision: insertion order breaks ties.
      .orderBy(desc(activity.createdAt), desc(sql`rowid`))
      .limit(Math.min(opts.limit ?? 30, 100))
    return this.markTrashed(workspaceId, rows.map(toActivityDTO))
  }

  /**
   * Where the next page starts, in the list's order. If the entry changed since (merged with a
   * later one, which moves it to the top), the time alone is the best there is.
   */
  private after(before: Date | undefined, beforeId: string | undefined) {
    if (!before) return undefined
    const anchor = beforeId
      ? this.deps.db.get<{ seq: number }>(sql`SELECT rowid AS seq FROM activity WHERE id = ${beforeId} AND created_at = ${before.getTime()}`)
      : undefined
    if (!anchor) return lt(activity.createdAt, before)
    return or(lt(activity.createdAt, before), and(eq(activity.createdAt, before), sql`rowid < ${anchor.seq}`))
  }

  /**
   * Entries about something that is in the trash now say so, with its key there: a link to it
   * would find nothing. What was deleted for good is in neither, and is told as text.
   */
  private markTrashed(workspaceId: string, entries: ActivityDTO[]) {
    const ids = [...new Set(entries.filter((e) => e.action !== 'trash.purged' && TRASH_TABLE[e.entityType]).map((e) => e.entityId))]
    if (ids.length === 0) return entries
    const found = this.deps.db.all<{ tableName: string; id: string }>(
      sql`SELECT r.table_name AS tableName, json_extract(r.data, '$.id') AS id FROM trash_rows r JOIN trash t ON t.id = r.trash_id
          WHERE t.workspace_id = ${workspaceId} AND json_extract(r.data, '$.id') IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`,
    )
    const trashed = new Set(found.map((r) => `${r.tableName}|${r.id}`))
    return entries.map((e) => {
      const table = e.action === 'trash.purged' ? undefined : TRASH_TABLE[e.entityType]
      return table && trashed.has(`${table}|${e.entityId}`) ? { ...e, inTrash: `${e.entityType}:${e.entityId}` } : e
    })
  }
}

/** The table of the trash holding each kind of thing activity is about. */
const TRASH_TABLE: Partial<Record<EntityType, string>> = { project: 'projects', board: 'boards', column: 'board_columns', card: 'cards', label: 'labels', page: 'pages' }
