import type { ActorRef, CardDetailDTO, CardSummaryDTO, ChecklistDTO, LabelDTO, PaletteColor } from '@orqevio/shared'
import {
  cardCreateInput,
  cardMoveInput,
  cardUpdateInput,
  checklistCreateInput,
  checklistItemCreateInput,
  checklistItemUpdateInput,
  checklistUpdateInput,
  linkPageInput,
} from '@orqevio/shared'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Actor } from '../auth/actor'
import { actorRef, hasScope } from '../auth/actor'
import type { DbOrTx } from '../db/client'
import {
  apiTokens,
  attachments,
  boards,
  cardLabels,
  cardPageLinks,
  cards,
  checklistItems,
  checklists,
  columns,
  labels,
  pages,
  users,
} from '../db/schema'
import { badRequest, notFound } from '../lib/errors'
import { parse } from '../lib/validate'
import type { Access } from './access'
import type { ActivityService } from './activity'
import { toAttachmentDTO } from './attachments'
import type { Deps } from './deps'
import { positionAt } from './ordering'

type CardRow = typeof cards.$inferSelect

export const toLabelDTO = (l: typeof labels.$inferSelect): LabelDTO => ({
  id: l.id,
  boardId: l.boardId,
  name: l.name,
  color: l.color as PaletteColor,
})

export class CardService {
  constructor(
    private readonly deps: Deps,
    private readonly access: Access,
    private readonly activity: ActivityService,
  ) {}

  /** Loads a card, enforcing workspace access and the given scope. */
  async load(actor: Actor, cardId: string, scope: 'tasks:read' | 'tasks:write' = 'tasks:read', db: DbOrTx = this.deps.db) {
    this.access.requireScope(actor, scope)
    const [card] = await db.select().from(cards).where(eq(cards.id, cardId))
    if (!card) throw notFound('Card')
    await this.access.workspace(actor, card.workspaceId)
    return card
  }

  /** Builds list summaries (labels, checklist progress, links) for many cards with few queries. */
  async summarize(rows: CardRow[], db: DbOrTx = this.deps.db): Promise<CardSummaryDTO[]> {
    if (rows.length === 0) return []
    const ids = rows.map((r) => r.id)
    const [labelRows, checklistRows, linkRows, attachmentRows, creators] = await Promise.all([
      db.select().from(cardLabels).where(inArray(cardLabels.cardId, ids)),
      db
        .select({
          cardId: checklists.cardId,
          total: sql<number>`count(${checklistItems.id})`,
          done: sql<number>`count(${checklistItems.id}) filter (where ${checklistItems.done} = 1)`,
        })
        .from(checklists)
        .leftJoin(checklistItems, eq(checklistItems.checklistId, checklists.id))
        .where(inArray(checklists.cardId, ids))
        .groupBy(checklists.cardId),
      db
        .select({ cardId: cardPageLinks.cardId, total: sql<number>`count(distinct ${cardPageLinks.pageId})` })
        .from(cardPageLinks)
        .where(inArray(cardPageLinks.cardId, ids))
        .groupBy(cardPageLinks.cardId),
      db
        .select({ cardId: attachments.cardId, total: sql<number>`count(*)` })
        .from(attachments)
        .where(inArray(attachments.cardId, ids))
        .groupBy(attachments.cardId),
      this.creatorNames(rows, db),
    ])
    return rows.map((card) => {
      const progress = checklistRows.find((c) => c.cardId === card.id)
      return {
        id: card.id,
        boardId: card.boardId,
        columnId: card.columnId,
        title: card.title,
        position: card.position,
        dueAt: card.dueAt?.toISOString() ?? null,
        labelIds: labelRows.filter((l) => l.cardId === card.id).map((l) => l.labelId),
        hasDescription: card.description.trim().length > 0,
        checklist: { done: progress?.done ?? 0, total: progress?.total ?? 0 },
        linkedPages: linkRows.find((l) => l.cardId === card.id)?.total ?? 0,
        attachments: attachmentRows.find((a) => a.cardId === card.id)?.total ?? 0,
        createdBy: creators.get(card.id) ?? null,
        createdAt: card.createdAt.toISOString(),
        updatedAt: card.updatedAt.toISOString(),
      }
    })
  }

  private async creatorNames(rows: CardRow[], db: DbOrTx) {
    const userIds = [...new Set(rows.flatMap((r) => (r.createdByUserId && !r.createdByTokenId ? [r.createdByUserId] : [])))]
    const tokenIds = [...new Set(rows.flatMap((r) => (r.createdByTokenId ? [r.createdByTokenId] : [])))]
    const [u, t] = await Promise.all([
      userIds.length ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : [],
      tokenIds.length
        ? db.select({ id: apiTokens.id, name: apiTokens.name }).from(apiTokens).where(inArray(apiTokens.id, tokenIds))
        : [],
    ])
    const result = new Map<string, ActorRef>()
    for (const r of rows) {
      if (r.createdByTokenId) {
        const token = t.find((x) => x.id === r.createdByTokenId)
        if (token) result.set(r.id, { kind: 'agent', id: token.id, name: token.name })
      } else if (r.createdByUserId) {
        const user = u.find((x) => x.id === r.createdByUserId)
        if (user) result.set(r.id, { kind: 'user', id: user.id, name: user.name })
      }
    }
    return result
  }

  async detail(actor: Actor, cardId: string): Promise<CardDetailDTO> {
    const card = await this.load(actor, cardId)
    const db = this.deps.db
    const [[summary], [column], [board], labelRows, checklistData, pageLinks, files, history] = await Promise.all([
      this.summarize([card]),
      db.select({ id: columns.id, name: columns.name }).from(columns).where(eq(columns.id, card.columnId)),
      db.select({ id: boards.id, name: boards.name, projectId: boards.projectId }).from(boards).where(eq(boards.id, card.boardId)),
      db
        .select({ label: labels })
        .from(cardLabels)
        .innerJoin(labels, eq(labels.id, cardLabels.labelId))
        .where(eq(cardLabels.cardId, cardId))
        .orderBy(asc(labels.createdAt)),
      this.checklistsFor(cardId),
      hasScope(actor, 'docs:read')
        ? db
            .select({ id: pages.id, title: pages.title, icon: pages.icon, projectId: pages.projectId, source: cardPageLinks.source })
            .from(cardPageLinks)
            .innerJoin(pages, eq(pages.id, cardPageLinks.pageId))
            .where(eq(cardPageLinks.cardId, cardId))
            .orderBy(asc(cardPageLinks.createdAt))
        : [],
      db.select().from(attachments).where(eq(attachments.cardId, cardId)).orderBy(asc(attachments.createdAt)),
      this.activity.list(card.workspaceId, { entityId: cardId, limit: 30 }),
    ])
    const linked = new Map<string, CardDetailDTO['pages'][number]>()
    for (const row of pageLinks) {
      const existing = linked.get(row.id)
      if (existing) existing.sources.push(row.source)
      else linked.set(row.id, { id: row.id, title: row.title, icon: row.icon, projectId: row.projectId, sources: [row.source] })
    }
    return {
      ...summary!,
      workspaceId: card.workspaceId,
      description: card.description,
      archivedAt: card.archivedAt?.toISOString() ?? null,
      column: column!,
      board: board!,
      labels: labelRows.map((r) => toLabelDTO(r.label)),
      checklists: checklistData,
      pages: [...linked.values()],
      attachmentList: files.map(toAttachmentDTO),
      activity: history,
    }
  }

  async checklistsFor(cardId: string): Promise<ChecklistDTO[]> {
    const db = this.deps.db
    const lists = await db.select().from(checklists).where(eq(checklists.cardId, cardId)).orderBy(asc(checklists.position), asc(checklists.id))
    if (lists.length === 0) return []
    const items = await db
      .select()
      .from(checklistItems)
      .where(inArray(checklistItems.checklistId, lists.map((l) => l.id)))
      .orderBy(asc(checklistItems.position), asc(checklistItems.id))
    return lists.map((l) => ({
      id: l.id,
      cardId: l.cardId,
      title: l.title,
      position: l.position,
      items: items
        .filter((i) => i.checklistId === l.id)
        .map((i) => ({ id: i.id, checklistId: i.checklistId, text: i.text, done: i.done, position: i.position })),
    }))
  }

  /** Synchronous: runs inside the create and update transactions. */
  private validLabelIds(db: DbOrTx, boardId: string, labelIds: string[]) {
    if (labelIds.length === 0) return []
    const rows = db
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.boardId, boardId), inArray(labels.id, labelIds)))
      .all()
    if (rows.length !== new Set(labelIds).size) throw badRequest('One or more labels do not belong to this board')
    return rows.map((r) => r.id)
  }

  async create(actor: Actor, columnId: string, input: unknown): Promise<CardSummaryDTO> {
    this.access.requireScope(actor, 'tasks:write')
    const data = parse(cardCreateInput, input)
    const [column] = await this.deps.db.select().from(columns).where(eq(columns.id, columnId))
    if (!column) throw notFound('Column')
    await this.access.workspace(actor, column.workspaceId)
    const card = this.deps.db.transaction((tx) => {
      const position = positionAt(tx, cards, and(eq(cards.columnId, columnId), isNull(cards.archivedAt)), data.index)
      const row = tx
        .insert(cards)
        .values({
          workspaceId: column.workspaceId,
          boardId: column.boardId,
          columnId,
          title: data.title,
          description: data.description ?? '',
          dueAt: data.dueAt ? new Date(data.dueAt) : null,
          position,
          createdByUserId: actor.userId,
          createdByTokenId: actor.kind === 'agent' ? actor.tokenId : null,
        })
        .returning()
        .get()
      const labelIds = this.validLabelIds(tx, column.boardId, data.labelIds ?? [])
      if (labelIds.length) tx.insert(cardLabels).values(labelIds.map((labelId) => ({ cardId: row.id, labelId }))).run()
      return row
    })
    await this.activity.record(
      actor,
      card.workspaceId,
      { action: 'card.created', entityType: 'card', entityId: card.id, summary: card.title, meta: { column: column.name } },
      { boardId: card.boardId, cardId: card.id },
    )
    const [summary] = await this.summarize([card])
    return summary!
  }

  async update(actor: Actor, cardId: string, input: unknown): Promise<CardSummaryDTO> {
    const data = parse(cardUpdateInput, input)
    const card = await this.load(actor, cardId, 'tasks:write')
    const updated = this.deps.db.transaction((tx) => {
      const patch: Partial<CardRow> = { updatedAt: new Date() }
      if (data.title !== undefined) patch.title = data.title
      if (data.description !== undefined) patch.description = data.description
      if (data.dueAt !== undefined) patch.dueAt = data.dueAt ? new Date(data.dueAt) : null
      const row = tx.update(cards).set(patch).where(eq(cards.id, cardId)).returning().get()!
      if (data.labelIds) {
        const labelIds = this.validLabelIds(tx, card.boardId, data.labelIds)
        tx.delete(cardLabels).where(eq(cardLabels.cardId, cardId)).run()
        if (labelIds.length) tx.insert(cardLabels).values(labelIds.map((labelId) => ({ cardId, labelId }))).run()
      }
      return row
    })
    const changed = Object.keys(data).filter((k) => data[k as keyof typeof data] !== undefined)
    await this.activity.record(
      actor,
      card.workspaceId,
      {
        action: 'card.updated',
        entityType: 'card',
        entityId: cardId,
        summary: updated.title,
        meta: { fields: changed.join(',') },
        coalesce: true,
      },
      { boardId: card.boardId, cardId },
    )
    const [summary] = await this.summarize([updated])
    return summary!
  }

  async move(actor: Actor, cardId: string, input: unknown): Promise<CardSummaryDTO> {
    const { columnId, index } = parse(cardMoveInput, input)
    const card = await this.load(actor, cardId, 'tasks:write')
    const [target] = await this.deps.db.select().from(columns).where(eq(columns.id, columnId))
    if (!target || target.boardId !== card.boardId) throw badRequest('The column must belong to the same board')
    const moved = this.deps.db.transaction((tx) => {
      const position = positionAt(tx, cards, and(eq(cards.columnId, columnId), isNull(cards.archivedAt)), index, cardId)
      return tx.update(cards).set({ columnId, position, updatedAt: new Date() }).where(eq(cards.id, cardId)).returning().get()!
    })
    if (card.columnId !== columnId) {
      const [from] = await this.deps.db.select({ name: columns.name }).from(columns).where(eq(columns.id, card.columnId))
      await this.activity.record(
        actor,
        card.workspaceId,
        { action: 'card.moved', entityType: 'card', entityId: cardId, summary: card.title, meta: { from: from?.name ?? null, to: target.name } },
        { boardId: card.boardId, cardId },
      )
    } else {
      await this.activity.emit(card.workspaceId, {
        action: 'card.reordered',
        actor: actorRef(actor),
        boardId: card.boardId,
        cardId,
      })
    }
    const [summary] = await this.summarize([moved])
    return summary!
  }

  async setArchived(actor: Actor, cardId: string, archived: boolean) {
    const card = await this.load(actor, cardId, 'tasks:write')
    const patch: Partial<CardRow> = { archivedAt: archived ? new Date() : null, updatedAt: new Date() }
    if (!archived) {
      // Restored cards return to the end of their column.
      patch.position = positionAt(this.deps.db, cards, and(eq(cards.columnId, card.columnId), isNull(cards.archivedAt)), undefined, cardId)
    }
    await this.deps.db.update(cards).set(patch).where(eq(cards.id, cardId))
    await this.activity.record(
      actor,
      card.workspaceId,
      { action: archived ? 'card.archived' : 'card.restored', entityType: 'card', entityId: cardId, summary: card.title },
      { boardId: card.boardId, cardId },
    )
  }

  async remove(actor: Actor, cardId: string) {
    this.access.requireUser(actor)
    const card = await this.load(actor, cardId, 'tasks:write')
    await this.deps.db.delete(cards).where(eq(cards.id, cardId))
    await this.activity.record(
      actor,
      card.workspaceId,
      { action: 'card.deleted', entityType: 'card', entityId: cardId, summary: card.title },
      { boardId: card.boardId, cardId },
    )
  }

  // ── Checklists ────────────────────────────────────────────────
  private async touch(actor: Actor, card: CardRow, detail: string) {
    await this.deps.db.update(cards).set({ updatedAt: new Date() }).where(eq(cards.id, card.id))
    await this.activity.record(
      actor,
      card.workspaceId,
      { action: 'card.checklist', entityType: 'card', entityId: card.id, summary: card.title, meta: { detail }, coalesce: true },
      { boardId: card.boardId, cardId: card.id },
    )
  }

  async createChecklist(actor: Actor, cardId: string, input: unknown) {
    const { title } = parse(checklistCreateInput, input)
    const card = await this.load(actor, cardId, 'tasks:write')
    const position = positionAt(this.deps.db, checklists, eq(checklists.cardId, cardId), undefined)
    const [row] = await this.deps.db.insert(checklists).values({ workspaceId: card.workspaceId, cardId, title, position }).returning()
    await this.touch(actor, card, title)
    return { id: row!.id, cardId, title, position, items: [] } satisfies ChecklistDTO
  }

  private async loadChecklist(actor: Actor, checklistId: string) {
    const [list] = await this.deps.db.select().from(checklists).where(eq(checklists.id, checklistId))
    if (!list) throw notFound('Checklist')
    const card = await this.load(actor, list.cardId, 'tasks:write')
    return { list, card }
  }

  async updateChecklist(actor: Actor, checklistId: string, input: unknown) {
    const { title } = parse(checklistUpdateInput, input)
    const { card } = await this.loadChecklist(actor, checklistId)
    await this.deps.db.update(checklists).set({ title }).where(eq(checklists.id, checklistId))
    await this.touch(actor, card, title)
  }

  async removeChecklist(actor: Actor, checklistId: string) {
    const { list, card } = await this.loadChecklist(actor, checklistId)
    await this.deps.db.delete(checklists).where(eq(checklists.id, checklistId))
    await this.touch(actor, card, list.title)
  }

  async addItem(actor: Actor, checklistId: string, input: unknown) {
    const { text } = parse(checklistItemCreateInput, input)
    const { list, card } = await this.loadChecklist(actor, checklistId)
    const position = positionAt(this.deps.db, checklistItems, eq(checklistItems.checklistId, checklistId), undefined)
    const [row] = await this.deps.db
      .insert(checklistItems)
      .values({ workspaceId: list.workspaceId, checklistId, text, position })
      .returning()
    await this.touch(actor, card, text)
    return { id: row!.id, checklistId, text, done: false, position }
  }

  private async loadItem(actor: Actor, itemId: string) {
    const [item] = await this.deps.db.select().from(checklistItems).where(eq(checklistItems.id, itemId))
    if (!item) throw notFound('Checklist item')
    const { list, card } = await this.loadChecklist(actor, item.checklistId)
    return { item, list, card }
  }

  async updateItem(actor: Actor, itemId: string, input: unknown) {
    const data = parse(checklistItemUpdateInput, input)
    const { item, card } = await this.loadItem(actor, itemId)
    const patch: Partial<typeof checklistItems.$inferSelect> = { updatedAt: new Date() }
    if (data.text !== undefined) patch.text = data.text
    if (data.done !== undefined) patch.done = data.done
    if (data.index !== undefined) {
      patch.position = positionAt(this.deps.db, checklistItems, eq(checklistItems.checklistId, item.checklistId), data.index, itemId)
    }
    const [row] = await this.deps.db.update(checklistItems).set(patch).where(eq(checklistItems.id, itemId)).returning()
    await this.touch(actor, card, row!.text)
    return { id: row!.id, checklistId: row!.checklistId, text: row!.text, done: row!.done, position: row!.position }
  }

  async removeItem(actor: Actor, itemId: string) {
    const { item, card } = await this.loadItem(actor, itemId)
    await this.deps.db.delete(checklistItems).where(eq(checklistItems.id, itemId))
    await this.touch(actor, card, item.text)
  }

  // ── Card ↔ page links ─────────────────────────────────────────
  async linkPage(actor: Actor, cardId: string, input: unknown) {
    const { pageId } = parse(linkPageInput, input)
    this.access.requireAnyScope(actor, ['tasks:write', 'docs:write'])
    this.access.requireScope(actor, 'docs:read')
    const card = await this.load(actor, cardId, 'tasks:read')
    const [page] = await this.deps.db.select().from(pages).where(eq(pages.id, pageId))
    if (!page || page.workspaceId !== card.workspaceId) throw notFound('Page')
    await this.deps.db
      .insert(cardPageLinks)
      .values({ cardId, pageId, workspaceId: card.workspaceId, source: 'manual' })
      .onConflictDoNothing()
    await this.activity.record(
      actor,
      card.workspaceId,
      { action: 'card.linked', entityType: 'card', entityId: cardId, summary: card.title, meta: { page: page.title || 'Untitled' } },
      { boardId: card.boardId, cardId, pageId },
    )
  }

  async unlinkPage(actor: Actor, cardId: string, pageId: string) {
    this.access.requireAnyScope(actor, ['tasks:write', 'docs:write'])
    const card = await this.load(actor, cardId, 'tasks:read')
    await this.deps.db
      .delete(cardPageLinks)
      .where(and(eq(cardPageLinks.cardId, cardId), eq(cardPageLinks.pageId, pageId), eq(cardPageLinks.source, 'manual')))
    await this.activity.emit(card.workspaceId, {
      action: 'card.unlinked',
      actor: actorRef(actor),
      boardId: card.boardId,
      cardId,
      pageId,
    })
  }
}
