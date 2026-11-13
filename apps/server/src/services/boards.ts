import type { BoardDTO, CardSummaryDTO, ColumnDTO, PaletteColor } from '@orqevio/shared'
import {
  DEFAULT_COLUMNS,
  DEFAULT_LOCALE,
  isLocale,
  boardCreateInput,
  boardUpdateInput,
  columnCreateInput,
  columnUpdateInput,
  labelCreateInput,
  labelUpdateInput,
} from '@orqevio/shared'
import { and, asc, count, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import type { Actor } from '../auth/actor'
import { actorRef } from '../auth/actor'
import { boards, cards, columns, labels, projects, users } from '../db/schema'
import { notFound } from '../lib/errors'
import { parse } from '../lib/validate'
import type { Access } from './access'
import type { ActivityService } from './activity'
import type { CardService } from './cards'
import { toLabelDTO } from './cards'
import type { Deps } from './deps'
import { evenlySpacedKeys } from '../lib/positions'
import { positionAt } from './ordering'


const toColumnDTO = (c: typeof columns.$inferSelect): ColumnDTO => ({
  id: c.id,
  boardId: c.boardId,
  name: c.name,
  position: c.position,
})

export class BoardService {
  constructor(
    private readonly deps: Deps,
    private readonly access: Access,
    private readonly activity: ActivityService,
    private readonly cards: CardService,
  ) {}

  async load(actor: Actor, boardId: string, scope: 'tasks:read' | 'tasks:write' = 'tasks:read') {
    this.access.requireScope(actor, scope)
    const [board] = await this.deps.db.select().from(boards).where(eq(boards.id, boardId))
    if (!board) throw notFound('Board')
    await this.access.workspace(actor, board.workspaceId)
    return board
  }

  private async localeOf(userId: string) {
    const [user] = await this.deps.db.select({ locale: users.locale }).from(users).where(eq(users.id, userId))
    return isLocale(user?.locale) ? user.locale : DEFAULT_LOCALE
  }

  async create(actor: Actor, projectId: string, input: unknown) {
    this.access.requireScope(actor, 'tasks:write')
    const data = parse(boardCreateInput, input)
    const [project] = await this.deps.db.select().from(projects).where(eq(projects.id, projectId))
    if (!project) throw notFound('Project')
    await this.access.workspace(actor, project.workspaceId)
    // Default columns are named in the language of whoever the board is for (an agent works for its owner).
    const columnNames = data.columns?.length ? data.columns : DEFAULT_COLUMNS[await this.localeOf(actor.userId)]
    const board = this.deps.db.transaction((tx) => {
      const position = positionAt(tx, boards, eq(boards.projectId, projectId), undefined)
      const b = tx.insert(boards).values({ workspaceId: project.workspaceId, projectId, name: data.name, position }).returning().get()
      const keys = evenlySpacedKeys(columnNames.length)
      tx.insert(columns)
        .values(columnNames.map((name, i) => ({ workspaceId: project.workspaceId, boardId: b.id, name, position: keys[i]! })))
        .run()
      return b
    })
    await this.activity.record(
      actor,
      board.workspaceId,
      { action: 'board.created', entityType: 'board', entityId: board.id, summary: board.name },
      { boardId: board.id, projectId, structure: true },
    )
    return { id: board.id, projectId, name: board.name, position: board.position, cardCount: 0 }
  }

  async get(actor: Actor, boardId: string): Promise<BoardDTO> {
    const board = await this.load(actor, boardId)
    const db = this.deps.db
    const [[project], columnRows, cardRows, labelRows] = await Promise.all([
      db.select({ id: projects.id, name: projects.name, color: projects.color }).from(projects).where(eq(projects.id, board.projectId)),
      db.select().from(columns).where(eq(columns.boardId, boardId)).orderBy(asc(columns.position), asc(columns.id)),
      db
        .select()
        .from(cards)
        .where(and(eq(cards.boardId, boardId), isNull(cards.archivedAt)))
        .orderBy(asc(cards.position), asc(cards.id)),
      db.select().from(labels).where(eq(labels.boardId, boardId)).orderBy(asc(labels.createdAt), asc(labels.id)),
    ])
    return {
      id: board.id,
      projectId: board.projectId,
      workspaceId: board.workspaceId,
      name: board.name,
      project: { id: project!.id, name: project!.name, color: project!.color as PaletteColor },
      columns: columnRows.map(toColumnDTO),
      cards: await this.cards.summarize(cardRows),
      labels: labelRows.map(toLabelDTO),
    }
  }

  async archived(actor: Actor, boardId: string): Promise<CardSummaryDTO[]> {
    await this.load(actor, boardId)
    const rows = await this.deps.db
      .select()
      .from(cards)
      .where(and(eq(cards.boardId, boardId), isNotNull(cards.archivedAt)))
      .orderBy(desc(cards.archivedAt))
      .limit(200)
    return this.cards.summarize(rows)
  }

  async update(actor: Actor, boardId: string, input: unknown) {
    const { name } = parse(boardUpdateInput, input)
    const board = await this.load(actor, boardId, 'tasks:write')
    await this.deps.db.update(boards).set({ name, updatedAt: new Date() }).where(eq(boards.id, boardId))
    await this.activity.record(
      actor,
      board.workspaceId,
      { action: 'board.updated', entityType: 'board', entityId: boardId, summary: name },
      { boardId, projectId: board.projectId, structure: true },
    )
  }

  async remove(actor: Actor, boardId: string) {
    this.access.requireUser(actor)
    const board = await this.load(actor, boardId, 'tasks:write')
    await this.deps.db.delete(boards).where(eq(boards.id, boardId))
    await this.activity.record(
      actor,
      board.workspaceId,
      { action: 'board.deleted', entityType: 'board', entityId: boardId, summary: board.name },
      { boardId, projectId: board.projectId, structure: true },
    )
  }

  // ── Columns ───────────────────────────────────────────────────
  async createColumn(actor: Actor, boardId: string, input: unknown): Promise<ColumnDTO> {
    const data = parse(columnCreateInput, input)
    const board = await this.load(actor, boardId, 'tasks:write')
    const position = positionAt(this.deps.db, columns, eq(columns.boardId, boardId), data.index)
    const [column] = await this.deps.db
      .insert(columns)
      .values({ workspaceId: board.workspaceId, boardId, name: data.name, position })
      .returning()
    await this.activity.record(
      actor,
      board.workspaceId,
      { action: 'column.created', entityType: 'column', entityId: column!.id, summary: data.name, meta: { board: board.name } },
      { boardId },
    )
    return toColumnDTO(column!)
  }

  async loadColumn(actor: Actor, columnId: string, scope: 'tasks:read' | 'tasks:write' = 'tasks:read') {
    this.access.requireScope(actor, scope)
    const [column] = await this.deps.db.select().from(columns).where(eq(columns.id, columnId))
    if (!column) throw notFound('Column')
    await this.access.workspace(actor, column.workspaceId)
    return column
  }

  async updateColumn(actor: Actor, columnId: string, input: unknown): Promise<ColumnDTO> {
    const data = parse(columnUpdateInput, input)
    const column = await this.loadColumn(actor, columnId, 'tasks:write')
    const patch: Partial<typeof columns.$inferSelect> = {}
    if (data.name !== undefined) patch.name = data.name
    if (data.index !== undefined) {
      patch.position = positionAt(this.deps.db, columns, eq(columns.boardId, column.boardId), data.index, columnId)
    }
    if (Object.keys(patch).length === 0) return toColumnDTO(column)
    const [row] = await this.deps.db.update(columns).set(patch).where(eq(columns.id, columnId)).returning()
    await this.activity.record(
      actor,
      column.workspaceId,
      {
        action: data.index !== undefined && data.name === undefined ? 'column.moved' : 'column.updated',
        entityType: 'column',
        entityId: columnId,
        summary: row!.name,
      },
      { boardId: column.boardId },
    )
    return toColumnDTO(row!)
  }

  async removeColumn(actor: Actor, columnId: string) {
    this.access.requireUser(actor)
    const column = await this.loadColumn(actor, columnId, 'tasks:write')
    const [{ total }] = (await this.deps.db.select({ total: count() }).from(cards).where(eq(cards.columnId, columnId))) as [{ total: number }]
    await this.deps.db.delete(columns).where(eq(columns.id, columnId))
    await this.activity.record(
      actor,
      column.workspaceId,
      { action: 'column.deleted', entityType: 'column', entityId: columnId, summary: column.name, meta: { cards: total } },
      { boardId: column.boardId, structure: total > 0 },
    )
  }

  // ── Labels ────────────────────────────────────────────────────
  async createLabel(actor: Actor, boardId: string, input: unknown) {
    const data = parse(labelCreateInput, input)
    const board = await this.load(actor, boardId, 'tasks:write')
    const [label] = await this.deps.db
      .insert(labels)
      .values({ workspaceId: board.workspaceId, boardId, name: data.name, color: data.color })
      .returning()
    await this.activity.emit(board.workspaceId, { action: 'label.created', actor: actorRef(actor), boardId })
    return toLabelDTO(label!)
  }

  private async loadLabel(actor: Actor, labelId: string) {
    this.access.requireScope(actor, 'tasks:write')
    const [label] = await this.deps.db.select().from(labels).where(eq(labels.id, labelId))
    if (!label) throw notFound('Label')
    await this.access.workspace(actor, label.workspaceId)
    return label
  }

  async updateLabel(actor: Actor, labelId: string, input: unknown) {
    const data = parse(labelUpdateInput, input)
    const label = await this.loadLabel(actor, labelId)
    const [row] = await this.deps.db.update(labels).set(data).where(eq(labels.id, labelId)).returning()
    await this.activity.emit(label.workspaceId, { action: 'label.updated', actor: actorRef(actor), boardId: label.boardId })
    return toLabelDTO(row!)
  }

  async removeLabel(actor: Actor, labelId: string) {
    const label = await this.loadLabel(actor, labelId)
    await this.deps.db.delete(labels).where(eq(labels.id, labelId))
    await this.activity.emit(label.workspaceId, { action: 'label.deleted', actor: actorRef(actor), boardId: label.boardId })
  }
}
