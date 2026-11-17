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
import { badRequest, conflict, notFound } from '../lib/errors'
import { parse } from '../lib/validate'
import type { Access } from './access'
import type { ActivityService } from './activity'
import { toAttachmentDTO } from './attachments'
import type { Deps } from './deps'
import type { Change, HistoryService } from './history'
import type { TrashService } from './trash'
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
    private readonly trash: TrashService,
    private readonly history: HistoryService,
  ) {}

  /** Records a change in the card's history; run it in the transaction that makes the change. */
  private change(db: DbOrTx, actor: Actor, card: Pick<CardRow, 'id' | 'workspaceId'>, change: Omit<Change, 'entityType' | 'entityId'>) {
    this.history.record(db, actor, card.workspaceId, { entityType: 'card', entityId: card.id, ...change })
  }

  /** Names of labels, in the order of the ids, for the history to show as they were. */
  private labelNames(db: DbOrTx, ids: string[]) {
    if (ids.length === 0) return []
    const rows = db.select({ id: labels.id, name: labels.name }).from(labels).where(inArray(labels.id, ids)).all()
    return ids.map((id) => rows.find((r) => r.id === id)?.name ?? '')
  }

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
        version: card.version,
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
      this.change(tx, actor, row, { kind: 'card.created', meta: { title: row.title, column: column.name } })
      // A card made with a description starts its history with that version.
      if (row.description) this.change(tx, actor, row, { kind: 'card.description', before: '', after: row.description })
      return row
    })
    await this.activity.record(
      actor,
      card.workspaceId,
      { action: 'card.created', entityType: 'card', entityId: card.id, summary: card.title, meta: { column: column.name } },
      { boardId: card.boardId, cardId: card.id, structure: true },
    )
    const [summary] = await this.summarize([card])
    return summary!
  }

  async update(actor: Actor, cardId: string, input: unknown): Promise<CardSummaryDTO> {
    const data = parse(cardUpdateInput, input)
    const card = await this.load(actor, cardId, 'tasks:write')
    const updated = this.deps.db.transaction((tx) => {
      const prev = tx.select().from(cards).where(eq(cards.id, cardId)).get()
      if (!prev) throw notFound('Card')
      // `version` tracks the description only, as with pages: renaming a card or
      // changing its labels never conflicts with someone editing its description.
      const patch: Record<string, unknown> = { updatedAt: new Date() }
      if (data.title !== undefined) patch.title = data.title
      if (data.description !== undefined) {
        patch.description = data.description
        patch.version = sql`${cards.version} + 1`
      }
      if (data.dueAt !== undefined) patch.dueAt = data.dueAt ? new Date(data.dueAt) : null
      const guard =
        data.description !== undefined && data.baseVersion !== undefined
          ? and(eq(cards.id, cardId), eq(cards.version, data.baseVersion))
          : eq(cards.id, cardId)
      const row = tx.update(cards).set(patch).where(guard).returning().get()
      if (!row) {
        const latest = tx.select({ version: cards.version }).from(cards).where(eq(cards.id, cardId)).get()
        throw conflict('This card was modified since you loaded it', { currentVersion: latest?.version ?? null })
      }
      if (data.title !== undefined) this.change(tx, actor, row, { kind: 'card.title', before: prev.title, after: row.title })
      if (data.description !== undefined) this.change(tx, actor, row, { kind: 'card.description', before: prev.description, after: row.description })
      if (data.dueAt !== undefined) this.change(tx, actor, row, { kind: 'card.due', before: prev.dueAt?.toISOString() ?? null, after: row.dueAt?.toISOString() ?? null })
      if (data.labelIds) {
        const labelIds = this.validLabelIds(tx, card.boardId, data.labelIds)
        const was = tx.select({ id: cardLabels.labelId }).from(cardLabels).where(eq(cardLabels.cardId, cardId)).all().map((l) => l.id)
        tx.delete(cardLabels).where(eq(cardLabels.cardId, cardId)).run()
        if (labelIds.length) tx.insert(cardLabels).values(labelIds.map((labelId) => ({ cardId, labelId }))).run()
        const added = labelIds.filter((id) => !was.includes(id))
        const removed = was.filter((id) => !labelIds.includes(id))
        if (added.length || removed.length) {
          this.change(tx, actor, row, {
            kind: 'card.labels',
            before: [...was].sort(),
            after: [...labelIds].sort(),
            meta: { added: this.labelNames(tx, added), removed: this.labelNames(tx, removed) },
          })
        }
      }
      return row
    })
    const changed = Object.keys(data).filter((k) => k !== 'baseVersion' && data[k as keyof typeof data] !== undefined)
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
      // Only changes to the description carry a version, so an open card refreshes its text only for those.
      { boardId: card.boardId, cardId, ...(data.description !== undefined ? { version: updated.version } : {}) },
    )
    const [summary] = await this.summarize([updated])
    return summary!
  }

  async move(actor: Actor, cardId: string, input: unknown): Promise<CardSummaryDTO> {
    const { columnId, index } = parse(cardMoveInput, input)
    const card = await this.load(actor, cardId, 'tasks:write')
    const [target] = await this.deps.db.select().from(columns).where(eq(columns.id, columnId))
    if (!target || target.workspaceId !== card.workspaceId) throw badRequest('The column must belong to the same workspace')
    // Another board is a move between boards: agents need to be allowed to delete and move.
    const otherBoard = target.boardId !== card.boardId
    if (otherBoard) this.access.requireScope(actor, 'organize')
    const boardName = (id: string) => (otherBoard ? this.deps.db.select({ name: boards.name }).from(boards).where(eq(boards.id, id)).get()?.name : undefined)
    const moved = this.deps.db.transaction((tx) => {
      const prev = tx.select({ columnId: cards.columnId, boardId: cards.boardId }).from(cards).where(eq(cards.id, cardId)).get()
      const position = positionAt(tx, cards, and(eq(cards.columnId, columnId), isNull(cards.archivedAt)), index, cardId)
      const row = tx.update(cards).set({ columnId, boardId: target.boardId, position, updatedAt: new Date() }).where(eq(cards.id, cardId)).returning().get()!
      if (prev && prev.columnId !== columnId) {
        const from = tx.select({ name: columns.name }).from(columns).where(eq(columns.id, prev.columnId)).get()
        // Between boards, where each column is says which board too.
        const place = (board: string | undefined, column: string | null | undefined) => (board ? `${board} › ${column ?? ''}` : (column ?? null))
        this.change(tx, actor, row, {
          kind: 'card.moved',
          before: { boardId: prev.boardId, columnId: prev.columnId },
          after: { boardId: row.boardId, columnId },
          meta: { from: place(boardName(prev.boardId), from?.name), to: place(boardName(target.boardId), target.name) },
        })
      }
      if (otherBoard) {
        // Labels belong to a board: those of the old one come off, as the history says.
        const was = tx.select({ id: cardLabels.labelId }).from(cardLabels).where(eq(cardLabels.cardId, cardId)).all().map((l) => l.id)
        if (was.length) {
          tx.delete(cardLabels).where(eq(cardLabels.cardId, cardId)).run()
          this.change(tx, actor, row, { kind: 'card.labels', before: [...was].sort(), after: [], meta: { added: [], removed: this.labelNames(tx, was) } })
        }
      }
      return row
    })
    if (card.columnId !== columnId) {
      const [from] = await this.deps.db.select({ name: columns.name }).from(columns).where(eq(columns.id, card.columnId))
      await this.activity.record(
        actor,
        card.workspaceId,
        { action: 'card.moved', entityType: 'card', entityId: cardId, summary: card.title, meta: { from: from?.name ?? null, to: target.name } },
        { boardId: card.boardId, cardId, ...(otherBoard ? { structure: true } : {}) },
      )
      // The board it went to hears of it too.
      if (otherBoard) await this.activity.emit(card.workspaceId, { action: 'card.moved', actor: actorRef(actor), boardId: target.boardId, cardId, structure: true })
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
    this.deps.db.transaction((tx) => {
      const prev = tx.select({ archivedAt: cards.archivedAt }).from(cards).where(eq(cards.id, cardId)).get()
      tx.update(cards).set(patch).where(eq(cards.id, cardId)).run()
      if (prev) this.change(tx, actor, card, { kind: 'card.archived', before: prev.archivedAt !== null, after: archived })
    })
    await this.activity.record(
      actor,
      card.workspaceId,
      { action: archived ? 'card.archived' : 'card.restored', entityType: 'card', entityId: cardId, summary: card.title },
      { boardId: card.boardId, cardId, structure: true },
    )
  }

  /** Moves the card to the trash, with its checklists, labels, links and attachments. */
  async remove(actor: Actor, cardId: string) {
    this.access.requireScope(actor, 'organize')
    const card = await this.load(actor, cardId, 'tasks:write')
    const trashId = this.deps.db.transaction((tx) => {
      const trashId = this.trash.move(tx, actor, card.workspaceId, { kind: 'card', id: cardId })
      this.change(tx, actor, card, { kind: 'card.deleted', meta: { trashId } })
      return trashId
    })
    await this.activity.record(
      actor,
      card.workspaceId,
      { action: 'card.deleted', entityType: 'card', entityId: cardId, summary: card.title },
      { boardId: card.boardId, cardId, structure: true },
    )
    return trashId
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
    const row = this.deps.db.transaction((tx) => {
      const position = positionAt(tx, checklists, eq(checklists.cardId, cardId), undefined)
      const row = tx.insert(checklists).values({ workspaceId: card.workspaceId, cardId, title, position }).returning().get()
      this.change(tx, actor, card, { kind: 'checklist.created', subjectId: row.id, meta: { title } })
      return row
    })
    await this.touch(actor, card, title)
    return { id: row.id, cardId, title, position: row.position, items: [] } satisfies ChecklistDTO
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
    this.deps.db.transaction((tx) => {
      const prev = tx.select({ title: checklists.title }).from(checklists).where(eq(checklists.id, checklistId)).get()
      tx.update(checklists).set({ title }).where(eq(checklists.id, checklistId)).run()
      if (prev) this.change(tx, actor, card, { kind: 'checklist.title', subjectId: checklistId, before: prev.title, after: title })
    })
    await this.touch(actor, card, title)
  }

  /** To the trash, with its items. Agents need to be allowed to delete and move. */
  async removeChecklist(actor: Actor, checklistId: string) {
    this.access.requireScope(actor, 'organize')
    const { list, card } = await this.loadChecklist(actor, checklistId)
    const trashId = this.deps.db.transaction((tx) => {
      const trashId = this.trash.move(tx, actor, card.workspaceId, { kind: 'checklist', id: checklistId })
      this.change(tx, actor, card, { kind: 'checklist.deleted', subjectId: checklistId, meta: { title: list.title, trashId } })
      return trashId
    })
    await this.touch(actor, card, list.title)
    return trashId
  }

  async addItem(actor: Actor, checklistId: string, input: unknown) {
    const { text } = parse(checklistItemCreateInput, input)
    const { list, card } = await this.loadChecklist(actor, checklistId)
    const row = this.deps.db.transaction((tx) => {
      const position = positionAt(tx, checklistItems, eq(checklistItems.checklistId, checklistId), undefined)
      const row = tx.insert(checklistItems).values({ workspaceId: list.workspaceId, checklistId, text, position }).returning().get()
      this.change(tx, actor, card, { kind: 'item.created', subjectId: row.id, meta: { text, checklist: list.title } })
      return row
    })
    await this.touch(actor, card, text)
    return { id: row.id, checklistId, text, done: false, position: row.position }
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
    const row = this.deps.db.transaction((tx) => {
      const prev = tx.select().from(checklistItems).where(eq(checklistItems.id, itemId)).get()
      if (!prev) throw notFound('Checklist item')
      if (data.index !== undefined) patch.position = positionAt(tx, checklistItems, eq(checklistItems.checklistId, item.checklistId), data.index, itemId)
      const row = tx.update(checklistItems).set(patch).where(eq(checklistItems.id, itemId)).returning().get()!
      if (data.text !== undefined) this.change(tx, actor, card, { kind: 'item.text', subjectId: itemId, before: prev.text, after: row.text })
      if (data.done !== undefined) this.change(tx, actor, card, { kind: 'item.done', subjectId: itemId, before: prev.done, after: row.done, meta: { text: row.text } })
      return row
    })
    await this.touch(actor, card, row.text)
    return { id: row.id, checklistId: row.checklistId, text: row.text, done: row.done, position: row.position }
  }

  async removeItem(actor: Actor, itemId: string) {
    this.access.requireScope(actor, 'organize')
    const { item, card } = await this.loadItem(actor, itemId)
    const trashId = this.deps.db.transaction((tx) => {
      const trashId = this.trash.move(tx, actor, card.workspaceId, { kind: 'checklist_item', id: itemId })
      this.change(tx, actor, card, { kind: 'item.deleted', subjectId: itemId, meta: { text: item.text, trashId } })
      return trashId
    })
    await this.touch(actor, card, item.text)
    return trashId
  }

  // ── Card ↔ page links ─────────────────────────────────────────
  async linkPage(actor: Actor, cardId: string, input: unknown) {
    const { pageId } = parse(linkPageInput, input)
    this.access.requireAnyScope(actor, ['tasks:write', 'docs:write'])
    this.access.requireScope(actor, 'docs:read')
    const card = await this.load(actor, cardId, 'tasks:read')
    const [page] = await this.deps.db.select().from(pages).where(eq(pages.id, pageId))
    if (!page || page.workspaceId !== card.workspaceId) throw notFound('Page')
    this.deps.db.transaction((tx) => {
      const added = tx
        .insert(cardPageLinks)
        .values({ cardId, pageId, workspaceId: card.workspaceId, source: 'manual' })
        .onConflictDoNothing()
        .returning({ pageId: cardPageLinks.pageId })
        .all()
      if (added.length) this.change(tx, actor, card, { kind: 'card.linked', subjectId: pageId, meta: { page: page.title } })
    })
    await this.activity.record(
      actor,
      card.workspaceId,
      { action: 'card.linked', entityType: 'card', entityId: cardId, summary: card.title, meta: { page: page.title } },
      { boardId: card.boardId, cardId, pageId },
    )
  }

  /** To the trash. Agents need write access to tasks or documents, and to be allowed to delete and move. */
  async unlinkPage(actor: Actor, cardId: string, pageId: string) {
    this.access.requireScope(actor, 'organize')
    this.access.requireAnyScope(actor, ['tasks:write', 'docs:write'])
    const card = await this.load(actor, cardId, 'tasks:read')
    const [page] = await this.deps.db.select({ title: pages.title }).from(pages).where(eq(pages.id, pageId))
    const trashId = this.deps.db.transaction((tx) => {
      const trashId = this.trash.move(tx, actor, card.workspaceId, { kind: 'link', cardId, pageId })
      if (trashId) this.change(tx, actor, card, { kind: 'card.unlinked', subjectId: pageId, meta: { page: page?.title ?? '', trashId } })
      return trashId
    })
    if (!trashId) return null
    await this.activity.record(
      actor,
      card.workspaceId,
      { action: 'card.unlinked', entityType: 'card', entityId: cardId, summary: card.title, meta: { page: page?.title ?? '' } },
      { boardId: card.boardId, cardId, pageId },
    )
    return trashId
  }
}
