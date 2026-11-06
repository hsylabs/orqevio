import type { ActivityDTO, EntityType, RealtimeEvent } from '@orqevio/shared'
import { and, desc, eq, gt, lt } from 'drizzle-orm'
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
    let coalesced = false
    if (entry.coalesce) {
      const updated = await db
        .update(activity)
        .set({ createdAt: new Date(), summary: entry.summary, meta: entry.meta ?? {} })
        .where(
          and(
            eq(activity.entityId, entry.entityId),
            eq(activity.action, entry.action),
            eq(activity.actorKind, actor.kind),
            actorFilter,
            gt(activity.createdAt, new Date(Date.now() - COALESCE_MS)),
          ),
        )
        .returning({ id: activity.id })
      coalesced = updated.length > 0
    }
    if (!coalesced) {
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

  async list(workspaceId: string, opts: { limit?: number; before?: Date; entityId?: string; tokenId?: string; agentsOnly?: boolean } = {}) {
    const filters = [eq(activity.workspaceId, workspaceId)]
    if (opts.before) filters.push(lt(activity.createdAt, opts.before))
    if (opts.entityId) filters.push(eq(activity.entityId, opts.entityId))
    if (opts.tokenId) filters.push(eq(activity.actorTokenId, opts.tokenId))
    if (opts.agentsOnly) filters.push(eq(activity.actorKind, 'agent'))
    const rows = await this.deps.db
      .select()
      .from(activity)
      .where(and(...filters))
      .orderBy(desc(activity.createdAt))
      .limit(Math.min(opts.limit ?? 30, 100))
    return rows.map(toActivityDTO)
  }
}
