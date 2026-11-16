import {
  type EntityType,
  type RealtimeEvent,
  type RestoredDTO,
  TRASH_DAYS,
  type TrashContents,
  extractReferences,
  type TrashEntryDTO,
  type TrashKind,
} from '@orqevio/shared'
import { type SQL, and, desc, eq, getTableColumns, isNotNull, lte, sql } from 'drizzle-orm'
import { type SQLiteTable, getTableConfig } from 'drizzle-orm/sqlite-core'
import type { Actor } from '../auth/actor'
import type { DbOrTx } from '../db/client'
import * as schema from '../db/schema'
import { AppError, notFound } from '../lib/errors'
import { keyAtEnd } from '../lib/positions'
import type { Access } from './access'
import type { ActivityService } from './activity'
import type { Deps } from './deps'
import { deletePageTrees, pageTree } from './pages'

/**
 * The tables an item in the trash can hold rows of, in the order they go back in:
 * what holds something always comes before it.
 */
const TABLES = {
  projects: schema.projects,
  boards: schema.boards,
  board_columns: schema.columns,
  labels: schema.labels,
  cards: schema.cards,
  card_labels: schema.cardLabels,
  checklists: schema.checklists,
  checklist_items: schema.checklistItems,
  pages: schema.pages,
  card_page_links: schema.cardPageLinks,
  attachments: schema.attachments,
} satisfies Record<string, SQLiteTable>
type TableName = keyof typeof TABLES
const ORDER = Object.keys(TABLES) as TableName[]

/** The table holding the item itself. */
const ROOT_TABLE: Record<TrashKind, TableName> = {
  project: 'projects',
  board: 'boards',
  column: 'board_columns',
  card: 'cards',
  page: 'pages',
  attachment: 'attachments',
  label: 'labels',
  checklist: 'checklists',
  checklist_item: 'checklist_items',
  link: 'card_page_links',
}

const COUNTED: Partial<Record<TableName, keyof TrashContents>> = {
  boards: 'boards',
  board_columns: 'columns',
  cards: 'cards',
  pages: 'pages',
  attachments: 'attachments',
  checklists: 'checklists',
  checklist_items: 'items',
  labels: 'labels',
}

type Row = Record<string, unknown>
interface Captured {
  table: TableName
  data: Row
}

const DAY_MS = 24 * 60 * 60 * 1000
const SEPARATOR = ' › '

/** What to move to the trash: the item, by kind and id. A link is the card and the page it joins. */
export type TrashTarget = { kind: Exclude<TrashKind, 'link'>; id: string } | { kind: 'link'; cardId: string; pageId: string }

/** Every row of an item and of what it holds, read before they are deleted. */
class Snapshot {
  readonly rows: Captured[] = []
  private readonly seen = new Set<string>()

  constructor(private readonly db: DbOrTx) {}

  query(table: TableName, query: SQL) {
    for (const data of this.db.all<Row>(query)) {
      // Rows with an id are told apart by it; link rows, by their whole content (a few ids).
      const key = data.id != null ? `${table} ${String(data.id)}` : `${table} ${JSON.stringify(data)}`
      if (this.seen.has(key)) continue
      this.seen.add(key)
      this.rows.push({ table, data })
    }
  }

  where(table: TableName, where: SQL) {
    this.query(table, sql`SELECT * FROM ${sql.identifier(table)} WHERE ${where} ORDER BY rowid`)
  }

  /** `scope` selects card ids: the cards and everything on them. */
  cards(scope: SQL) {
    this.where('cards', sql`id IN (${scope})`)
    this.where('card_labels', sql`card_id IN (${scope})`)
    this.where('checklists', sql`card_id IN (${scope})`)
    this.where('checklist_items', sql`checklist_id IN (SELECT id FROM checklists WHERE card_id IN (${scope}))`)
    this.where('card_page_links', sql`card_id IN (${scope})`)
    this.where('attachments', sql`card_id IN (${scope})`)
  }

  /** The pages matching `roots`, with every page under them, top ones first. */
  pages(roots: SQL) {
    const tree = pageTree(roots)
    this.query('pages', sql`${tree} SELECT p.* FROM pages p JOIN tree t ON t.id = p.id ORDER BY t.depth, p.position, p.id`)
    this.query('card_page_links', sql`${tree} SELECT * FROM card_page_links WHERE page_id IN (SELECT id FROM tree)`)
    this.query('attachments', sql`${tree} SELECT * FROM attachments WHERE page_id IN (SELECT id FROM tree)`)
  }

  /** Parents before children; within a table, in the order they were read. */
  sorted() {
    return this.rows.map((row, i) => ({ row, i })).sort((a, b) => ORDER.indexOf(a.row.table) - ORDER.indexOf(b.row.table) || a.i - b.i).map((x) => x.row)
  }
}

const restoreError = (code: 'restore_place_in_trash' | 'restore_place_gone', message: string, details?: unknown) => new AppError(409, code, message, details)

/**
 * The trash. Deleting an item copies its rows, and those of everything it holds, into
 * `trash_rows` and then deletes them, all in one transaction. Restoring inserts them
 * again, with the same ids, wherever they still fit. Entries are deleted for good after
 * TRASH_DAYS, or when someone empties them; the files of their attachments go then.
 *
 * Only people see the trash, restore from it or delete from it for good.
 */
export class TrashService {
  constructor(
    private readonly deps: Deps,
    private readonly access: Access,
    private readonly activity: ActivityService,
  ) {}

  /**
   * Moves an item, with everything it holds, to the trash and deletes it. Synchronous, so
   * the caller can run it inside its own transaction. Returns the trash entry's id, or
   * null when there was nothing to delete.
   */
  move(db: DbOrTx, actor: Actor, workspaceId: string, target: TrashTarget): string | null {
    const snapshot = new Snapshot(db)
    const root = this.capture(db, snapshot, target)
    if (!root) return null
    const rows = snapshot.sorted()
    const contents: TrashContents = {}
    let bytes = 0
    for (const { table, data } of rows) {
      if (table === 'attachments') bytes += Number(data.size ?? 0)
      if (data === root.data) continue
      const counted = COUNTED[table]
      if (counted) contents[counted] = (contents[counted] ?? 0) + 1
    }
    const now = new Date()
    const [entry] = db
      .insert(schema.trash)
      .values({
        workspaceId,
        kind: target.kind,
        entityId: target.kind === 'link' ? `${target.cardId}:${target.pageId}` : target.id,
        title: root.title,
        location: root.location,
        contents,
        bytes,
        actorKind: actor.kind,
        actorUserId: actor.kind === 'user' ? actor.userId : null,
        actorTokenId: actor.kind === 'agent' ? actor.tokenId : null,
        actorName: actor.name,
        deletedAt: now,
        expiresAt: new Date(now.getTime() + TRASH_DAYS * DAY_MS),
      })
      .returning({ id: schema.trash.id })
      .all()
    for (const { table, data } of rows) {
      db.insert(schema.trashRows)
        .values({ trashId: entry!.id, tableName: table, data, storageKey: table === 'attachments' ? String(data.storage_key) : null })
        .run()
    }
    this.remove(db, target)
    return entry!.id
  }

  /** Reads the item's rows into `snapshot`; returns its own row, title and location, or null if it doesn't exist. */
  private capture(db: DbOrTx, snapshot: Snapshot, target: TrashTarget) {
    const one = (table: TableName, id: string) => db.get<Row>(sql`SELECT * FROM ${sql.identifier(table)} WHERE id = ${id}`)
    const name = (query: SQL) => db.get<{ name: string }>(query)?.name ?? ''
    const path = (...parts: string[]) => parts.filter(Boolean).join(SEPARATOR)
    const boardPath = (boardId: unknown) =>
      path(name(sql`SELECT p.name FROM boards b JOIN projects p ON p.id = b.project_id WHERE b.id = ${boardId}`), name(sql`SELECT name FROM boards WHERE id = ${boardId}`))
    const cardPath = (cardId: unknown) => {
      const card = db.get<{ board_id: string; column_id: string; title: string }>(sql`SELECT board_id, column_id, title FROM cards WHERE id = ${cardId}`)
      return card ? path(boardPath(card.board_id), card.title) : ''
    }
    const pagePath = (pageId: unknown) => {
      const page = db.get<{ project_id: string; title: string }>(sql`SELECT project_id, title FROM pages WHERE id = ${pageId}`)
      return page ? path(name(sql`SELECT name FROM projects WHERE id = ${page.project_id}`), page.title) : ''
    }

    switch (target.kind) {
      case 'project': {
        const row = one('projects', target.id)
        if (!row) return null
        snapshot.where('projects', sql`id = ${target.id}`)
        const boardIds = sql`SELECT id FROM boards WHERE project_id = ${target.id}`
        snapshot.where('boards', sql`project_id = ${target.id}`)
        snapshot.where('board_columns', sql`board_id IN (${boardIds})`)
        snapshot.where('labels', sql`board_id IN (${boardIds})`)
        snapshot.cards(sql`SELECT id FROM cards WHERE board_id IN (${boardIds})`)
        snapshot.pages(sql`project_id = ${target.id} AND parent_id IS NULL`)
        return { data: snapshot.rows[0]!.data, title: String(row.name), location: '' }
      }
      case 'board': {
        const row = one('boards', target.id)
        if (!row) return null
        snapshot.where('boards', sql`id = ${target.id}`)
        snapshot.where('board_columns', sql`board_id = ${target.id}`)
        snapshot.where('labels', sql`board_id = ${target.id}`)
        snapshot.cards(sql`SELECT id FROM cards WHERE board_id = ${target.id}`)
        return { data: snapshot.rows[0]!.data, title: String(row.name), location: name(sql`SELECT name FROM projects WHERE id = ${row.project_id}`) }
      }
      case 'column': {
        const row = one('board_columns', target.id)
        if (!row) return null
        snapshot.where('board_columns', sql`id = ${target.id}`)
        snapshot.cards(sql`SELECT id FROM cards WHERE column_id = ${target.id}`)
        return { data: snapshot.rows[0]!.data, title: String(row.name), location: boardPath(row.board_id) }
      }
      case 'card': {
        const row = one('cards', target.id)
        if (!row) return null
        snapshot.cards(sql`SELECT ${target.id}`)
        const column = name(sql`SELECT name FROM board_columns WHERE id = ${row.column_id}`)
        return { data: snapshot.rows[0]!.data, title: String(row.title), location: path(boardPath(row.board_id), column) }
      }
      case 'page': {
        const row = one('pages', target.id)
        if (!row) return null
        snapshot.pages(sql`id = ${target.id}`)
        const parent = row.parent_id ? name(sql`SELECT title AS name FROM pages WHERE id = ${row.parent_id}`) : ''
        return { data: snapshot.rows[0]!.data, title: String(row.title), location: path(name(sql`SELECT name FROM projects WHERE id = ${row.project_id}`), parent) }
      }
      case 'attachment': {
        const row = one('attachments', target.id)
        if (!row) return null
        snapshot.where('attachments', sql`id = ${target.id}`)
        return { data: snapshot.rows[0]!.data, title: String(row.filename), location: row.card_id ? cardPath(row.card_id) : pagePath(row.page_id) }
      }
      case 'label': {
        const row = one('labels', target.id)
        if (!row) return null
        snapshot.where('labels', sql`id = ${target.id}`)
        snapshot.where('card_labels', sql`label_id = ${target.id}`)
        return { data: snapshot.rows[0]!.data, title: String(row.name), location: boardPath(row.board_id) }
      }
      case 'checklist': {
        const row = one('checklists', target.id)
        if (!row) return null
        snapshot.where('checklists', sql`id = ${target.id}`)
        snapshot.where('checklist_items', sql`checklist_id = ${target.id}`)
        return { data: snapshot.rows[0]!.data, title: String(row.title), location: cardPath(row.card_id) }
      }
      case 'checklist_item': {
        const row = one('checklist_items', target.id)
        if (!row) return null
        snapshot.where('checklist_items', sql`id = ${target.id}`)
        const list = db.get<{ card_id: string; title: string }>(sql`SELECT card_id, title FROM checklists WHERE id = ${row.checklist_id}`)
        return { data: snapshot.rows[0]!.data, title: String(row.text), location: list ? path(cardPath(list.card_id), list.title) : '' }
      }
      case 'link': {
        snapshot.where('card_page_links', sql`card_id = ${target.cardId} AND page_id = ${target.pageId} AND source = 'manual'`)
        if (snapshot.rows.length === 0) return null
        const page = db.get<{ title: string }>(sql`SELECT title FROM pages WHERE id = ${target.pageId}`)
        return { data: snapshot.rows[0]!.data, title: page?.title ?? '', location: cardPath(target.cardId) }
      }
    }
  }

  /** Deletes the item; what it holds goes with it by cascade, page trees deepest first. */
  private remove(db: DbOrTx, target: TrashTarget) {
    switch (target.kind) {
      case 'project':
        deletePageTrees(db, sql`${schema.pages.projectId} = ${target.id} AND ${schema.pages.parentId} IS NULL`)
        db.delete(schema.projects).where(eq(schema.projects.id, target.id)).run()
        return
      case 'page':
        deletePageTrees(db, sql`${schema.pages.id} = ${target.id}`)
        return
      case 'link':
        db.delete(schema.cardPageLinks)
          .where(and(eq(schema.cardPageLinks.cardId, target.cardId), eq(schema.cardPageLinks.pageId, target.pageId), eq(schema.cardPageLinks.source, 'manual')))
          .run()
        return
      default: {
        const table = TABLES[ROOT_TABLE[target.kind]] as SQLiteTable & { id: typeof schema.cards.id }
        db.delete(table).where(eq(table.id, target.id)).run()
      }
    }
  }

  // ── People's side: listing, restoring, deleting for good ─────

  async list(actor: Actor, workspaceId: string): Promise<TrashEntryDTO[]> {
    this.access.requireUser(actor)
    await this.access.workspace(actor, workspaceId)
    const rows = await this.deps.db.select().from(schema.trash).where(eq(schema.trash.workspaceId, workspaceId)).orderBy(desc(schema.trash.deletedAt))
    return rows.map(toTrashEntryDTO)
  }

  private async load(actor: Actor, trashId: string) {
    this.access.requireUser(actor)
    const [entry] = await this.deps.db.select().from(schema.trash).where(eq(schema.trash.id, trashId))
    if (!entry) throw notFound('Trash entry')
    await this.access.workspace(actor, entry.workspaceId)
    return entry
  }

  /** Puts the item back, with everything it held. If its place is gone, in the first one available. */
  async restore(actor: Actor, trashId: string): Promise<RestoredDTO> {
    const entry = await this.load(actor, trashId)
    const result = this.deps.db.transaction((tx) => {
      const rows = tx
        .select({ table: schema.trashRows.tableName, data: schema.trashRows.data })
        .from(schema.trashRows)
        .where(eq(schema.trashRows.trashId, trashId))
        .orderBy(schema.trashRows.id)
        .all() as Captured[]
      const root = rows.find((r) => r.table === ROOT_TABLE[entry.kind])
      if (!root) throw notFound('Trash entry')
      const placed = this.place(tx, entry.workspaceId, entry.kind, root.data, rows)
      const reinsert = new Reinsert(tx)
      for (const row of rows) {
        // Mentions come from what pages say now: they are rebuilt below, not put back as they were.
        if (row.table === 'card_page_links' && row.data.source === 'mention') continue
        // Without the item itself nothing comes back: the transaction rolls back and the entry stays.
        if (!reinsert.insert(row) && row === root) throw restoreError('restore_place_gone', 'It no longer fits anywhere it could go back to.')
      }
      rebuildMentions(tx, entry.workspaceId, reinsert.cards, reinsert.pages)
      tx.delete(schema.trash).where(eq(schema.trash.id, trashId)).run()
      return placed
    })
    await this.activity.record(
      actor,
      entry.workspaceId,
      { action: 'trash.restored', entityType: result.entityType, entityId: result.entityId, summary: entry.title, meta: { kind: entry.kind, ...(result.movedTo ? { movedTo: result.movedTo } : {}) } },
      result.event,
    )
    return { kind: entry.kind, entityId: entry.entityId, movedTo: result.movedTo, path: result.path }
  }

  /**
   * Checks the item still has somewhere to go back to and points its row there. Cards,
   * columns, boards and pages whose place is gone go to the first one available; the
   * rest need theirs. Throws when there is none.
   */
  private place(tx: DbOrTx, workspaceId: string, kind: TrashKind, root: Row, rows: Captured[]) {
    const exists = (table: TableName, id: unknown) => id != null && Boolean(tx.get(sql`SELECT 1 AS found FROM ${sql.identifier(table)} WHERE id = ${id} LIMIT 1`))
    const atEnd = (table: TableName, scope: SQL) => {
      const keys = tx.all<{ position: string }>(sql`SELECT position FROM ${sql.identifier(table)} WHERE ${scope} ORDER BY position`).map((r) => r.position)
      return keyAtEnd(keys)
    }
    /** The place is gone: say so, or which entry of the trash holds it. */
    const missing = (table: TableName, id: unknown, what: string) => {
      const holder = tx.get<{ title: string }>(
        sql`SELECT t.title FROM trash_rows r JOIN trash t ON t.id = r.trash_id WHERE r.table_name = ${table} AND json_extract(r.data, '$.id') = ${id} LIMIT 1`,
      )
      if (holder) return restoreError('restore_place_in_trash', `Restore “${holder.title}” first: the ${what} it belongs to is in the trash too.`, { title: holder.title })
      return restoreError('restore_place_gone', `The ${what} it belonged to no longer exists, and there is nowhere else to put it.`)
    }
    const needs = (table: TableName, id: unknown, what: string) => {
      if (!exists(table, id)) throw missing(table, id, what)
    }
    const firstProject = () => tx.get<{ id: string; name: string }>(sql`SELECT id, name FROM projects WHERE workspace_id = ${workspaceId} ORDER BY position, id LIMIT 1`)
    const firstBoard = () =>
      tx.get<{ id: string; name: string; project: string }>(
        sql`SELECT b.id, b.name, p.name AS project FROM boards b JOIN projects p ON p.id = b.project_id WHERE b.workspace_id = ${workspaceId} ORDER BY p.position, p.id, b.position, b.id LIMIT 1`,
      )
    const boardName = (boardId: unknown) =>
      tx.get<{ name: string; project: string }>(sql`SELECT b.name, p.name AS project FROM boards b JOIN projects p ON p.id = b.project_id WHERE b.id = ${boardId}`)
    const ofTable = (table: TableName) => rows.filter((r) => r.table === table).map((r) => r.data)
    const event = (e: Omit<RealtimeEvent, 'action' | 'actor' | 'summary'>) => e
    let movedTo: string | null = null

    switch (kind) {
      case 'project':
        return { entityType: 'project' as EntityType, entityId: String(root.id), movedTo, path: `p/${root.id}`, event: event({ projectId: String(root.id), structure: true }) }
      case 'board': {
        if (!exists('projects', root.project_id)) {
          const target = firstProject()
          if (!target) throw missing('projects', root.project_id, 'project')
          root.project_id = target.id
          root.position = atEnd('boards', sql`project_id = ${target.id}`)
          movedTo = target.name
        }
        return { entityType: 'board' as EntityType, entityId: String(root.id), movedTo, path: `b/${root.id}`, event: event({ boardId: String(root.id), projectId: String(root.project_id), structure: true }) }
      }
      case 'column': {
        if (!exists('boards', root.board_id)) {
          const target = firstBoard()
          if (!target) throw missing('boards', root.board_id, 'board')
          root.board_id = target.id
          root.position = atEnd('board_columns', sql`board_id = ${target.id}`)
          for (const card of ofTable('cards')) card.board_id = target.id
          movedTo = [target.project, target.name].join(SEPARATOR)
        }
        return { entityType: 'column' as EntityType, entityId: String(root.id), movedTo, path: `b/${root.board_id}`, event: event({ boardId: String(root.board_id), structure: true }) }
      }
      case 'card': {
        const column = tx.get<{ board_id: string; name: string }>(sql`SELECT board_id, name FROM board_columns WHERE id = ${root.column_id}`)
        if (column && column.board_id !== root.board_id) {
          // Its column went back to another board meanwhile: the card follows it there.
          const board = boardName(column.board_id)!
          root.board_id = column.board_id
          root.position = atEnd('cards', sql`column_id = ${root.column_id}`)
          movedTo = [board.project, board.name, column.name].join(SEPARATOR)
        } else if (!column) {
          // The first column of its board, or else of the first board that has one.
          const first = (scope: SQL) =>
            tx.get<{ id: string; name: string; board_id: string; board: string; project: string }>(
              sql`SELECT c.id, c.name, b.id AS board_id, b.name AS board, p.name AS project FROM board_columns c JOIN boards b ON b.id = c.board_id JOIN projects p ON p.id = b.project_id WHERE ${scope} ORDER BY p.position, p.id, b.position, b.id, c.position, c.id LIMIT 1`,
            )
          const target = first(sql`c.board_id = ${root.board_id}`) ?? first(sql`c.workspace_id = ${workspaceId}`)
          if (!target) throw missing('board_columns', root.column_id, 'column')
          root.board_id = target.board_id
          root.column_id = target.id
          root.position = atEnd('cards', sql`column_id = ${target.id}`)
          movedTo = [target.project, target.board, target.name].join(SEPARATOR)
        }
        return { entityType: 'card' as EntityType, entityId: String(root.id), movedTo, path: `b/${root.board_id}`, event: event({ boardId: String(root.board_id), cardId: String(root.id), structure: true }) }
      }
      case 'page': {
        const parent = root.parent_id != null ? tx.get<{ project_id: string }>(sql`SELECT project_id FROM pages WHERE id = ${root.parent_id}`) : undefined
        const projectName = (id: unknown) => tx.get<{ name: string }>(sql`SELECT name FROM projects WHERE id = ${id}`)?.name ?? null
        if (parent) {
          // Under its parent, in whatever project the parent is now: the pages follow it there.
          if (parent.project_id !== root.project_id) {
            for (const page of ofTable('pages')) page.project_id = parent.project_id
            root.position = atEnd('pages', sql`parent_id = ${root.parent_id}`)
            movedTo = projectName(parent.project_id)
          }
        } else if (!exists('projects', root.project_id)) {
          const target = firstProject()
          if (!target) throw missing('projects', root.project_id, 'project')
          for (const page of ofTable('pages')) page.project_id = target.id
          root.parent_id = null
          root.position = atEnd('pages', sql`project_id = ${target.id} AND parent_id IS NULL`)
          movedTo = target.name
        } else if (root.parent_id != null) {
          root.parent_id = null
          root.position = atEnd('pages', sql`project_id = ${root.project_id} AND parent_id IS NULL`)
          movedTo = projectName(root.project_id)
        }
        return { entityType: 'page' as EntityType, entityId: String(root.id), movedTo, path: `d/${root.id}`, event: event({ pageId: String(root.id), projectId: String(root.project_id), structure: true }) }
      }
      case 'attachment': {
        if (root.card_id != null) {
          needs('cards', root.card_id, 'card')
          const boardId = tx.get<{ board_id: string }>(sql`SELECT board_id FROM cards WHERE id = ${root.card_id}`)!.board_id
          return { entityType: 'card' as EntityType, entityId: String(root.card_id), movedTo, path: `b/${boardId}`, event: event({ boardId, cardId: String(root.card_id) }) }
        }
        needs('pages', root.page_id, 'page')
        return { entityType: 'page' as EntityType, entityId: String(root.page_id), movedTo, path: `d/${root.page_id}`, event: event({ pageId: String(root.page_id) }) }
      }
      case 'label':
        needs('boards', root.board_id, 'board')
        return { entityType: 'label' as EntityType, entityId: String(root.id), movedTo, path: `b/${root.board_id}`, event: event({ boardId: String(root.board_id) }) }
      case 'checklist':
      case 'checklist_item': {
        const cardId =
          kind === 'checklist'
            ? (needs('cards', root.card_id, 'card'), root.card_id)
            : (needs('checklists', root.checklist_id, 'checklist'), tx.get<{ card_id: string }>(sql`SELECT card_id FROM checklists WHERE id = ${root.checklist_id}`)!.card_id)
        const boardId = tx.get<{ board_id: string }>(sql`SELECT board_id FROM cards WHERE id = ${cardId}`)!.board_id
        return { entityType: 'card' as EntityType, entityId: String(cardId), movedTo, path: `b/${boardId}`, event: event({ boardId, cardId: String(cardId) }) }
      }
      case 'link': {
        needs('cards', root.card_id, 'card')
        needs('pages', root.page_id, 'page')
        const boardId = tx.get<{ board_id: string }>(sql`SELECT board_id FROM cards WHERE id = ${root.card_id}`)!.board_id
        return { entityType: 'card' as EntityType, entityId: String(root.card_id), movedTo, path: `b/${boardId}`, event: event({ boardId, cardId: String(root.card_id), pageId: String(root.page_id) }) }
      }
    }
  }

  /** Deletes an entry for good, with the files of its attachments. */
  async purge(actor: Actor, trashId: string) {
    const entry = await this.load(actor, trashId)
    await this.erase(trashId)
    await this.activity.record(actor, entry.workspaceId, {
      action: 'trash.purged',
      entityType: purgedEntityType(entry.kind),
      entityId: entry.entityId,
      summary: entry.title,
      meta: { kind: entry.kind },
    })
  }

  /** Deletes for good what has been in the trash for TRASH_DAYS. Runs hourly. */
  async purgeExpired(now = new Date()) {
    const expired = await this.deps.db.select({ id: schema.trash.id }).from(schema.trash).where(lte(schema.trash.expiresAt, now))
    for (const { id } of expired) await this.erase(id)
    return expired.length
  }

  private async erase(trashId: string) {
    const files = await this.deps.db
      .select({ key: schema.trashRows.storageKey })
      .from(schema.trashRows)
      .where(and(eq(schema.trashRows.trashId, trashId), isNotNull(schema.trashRows.storageKey)))
    await this.deps.db.delete(schema.trash).where(eq(schema.trash.id, trashId))
    // A file that fails to go now is left to the hourly sweep: nothing references it any more.
    for (const { key } of files) await this.deps.storage.delete(key!).catch(() => {})
  }

  /** Whether a stored file belongs to an attachment in the trash, so the sweep keeps it. */
  async holdsFile(storageKey: string) {
    const [row] = await this.deps.db.select({ id: schema.trashRows.id }).from(schema.trashRows).where(eq(schema.trashRows.storageKey, storageKey)).limit(1)
    return Boolean(row)
  }
}

/**
 * Rebuilds the mention links of restored cards and pages from what pages say now, as saving a
 * page does: a page edited while a card was in the trash may mention it, or no longer.
 */
function rebuildMentions(tx: DbOrTx, workspaceId: string, cards: Set<string>, pages: Set<string>) {
  if (cards.size === 0 && pages.size === 0) return
  const exists = new Map<string, boolean>()
  const isCard = (id: string) => {
    let found = exists.get(id)
    if (found === undefined) {
      found = Boolean(tx.get(sql`SELECT 1 AS found FROM cards WHERE id = ${id} AND workspace_id = ${workspaceId}`))
      exists.set(id, found)
    }
    return found
  }
  const mentioning = tx.all<{ id: string; content: string }>(sql`SELECT id, content FROM pages WHERE workspace_id = ${workspaceId} AND content LIKE '%/card/%'`)
  for (const page of mentioning) {
    if (cards.size === 0 && !pages.has(page.id)) continue
    // As many as saving the page links.
    for (const cardId of extractReferences(page.content).cards.slice(0, 200)) {
      if (!pages.has(page.id) && !cards.has(cardId)) continue
      if (!isCard(cardId)) continue
      tx.run(sql`INSERT OR IGNORE INTO card_page_links (card_id, page_id, workspace_id, source, created_at) VALUES (${cardId}, ${page.id}, ${workspaceId}, 'mention', ${Date.now()})`)
    }
  }
}

/** References that only say who made something: they are cleared when that person or token is gone. */
const AUTHORS = new Set(['users', 'api_tokens'])

/** For each table: its columns, and its references as [column, nullable?, table, column]. */
const SHAPES = new Map(
  ORDER.map((table) => {
    const definition = TABLES[table]
    const references = getTableConfig(definition).foreignKeys.map((fk) => {
      const reference = fk.reference()
      return { column: reference.columns[0]!.name, table: getTableConfig(reference.foreignTable).name, target: reference.foreignColumns[0]!.name }
    })
    return [table, { columns: Object.values(getTableColumns(definition)).map((c) => c.name), references }]
  }),
)

/**
 * Inserts rows back as they were. A reference to something that is no longer there is
 * cleared when it only says who made the row, and otherwise the row stays out: a
 * label whose label is gone, a link to a page that no longer exists. Each reference
 * is looked up once, and rows just put back count as there.
 */
class Reinsert {
  private readonly known = new Map<string, boolean>()
  /** The cards and pages put back, for rebuilding their mentions. */
  readonly cards = new Set<string>()
  readonly pages = new Set<string>()

  constructor(private readonly tx: DbOrTx) {}

  private exists(table: string, column: string, value: unknown) {
    const key = `${table} ${column} ${String(value)}`
    let found = this.known.get(key)
    if (found === undefined) {
      found = Boolean(this.tx.get(sql`SELECT 1 AS found FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} = ${value} LIMIT 1`))
      this.known.set(key, found)
    }
    return found
  }

  /** Returns whether the row went back in. */
  insert({ table, data }: Captured) {
    const shape = SHAPES.get(table)!
    for (const reference of shape.references) {
      const value = data[reference.column]
      if (value == null || this.exists(reference.table, reference.target, value)) continue
      if (!AUTHORS.has(reference.table)) return false
      data[reference.column] = null
    }
    // A card that went back to another board keeps only that board's labels.
    if (table === 'card_labels' && !this.tx.get(sql`SELECT 1 AS found FROM labels l JOIN cards c ON c.board_id = l.board_id WHERE l.id = ${data.label_id} AND c.id = ${data.card_id}`)) {
      return false
    }
    const names = shape.columns.filter((name) => name in data)
    this.tx.run(
      sql`INSERT OR IGNORE INTO ${sql.identifier(table)} (${sql.join(
        names.map((n) => sql.identifier(n)),
        sql`, `,
      )}) VALUES (${sql.join(
        names.map((n) => sql`${data[n] as string | number | null}`),
        sql`, `,
      )})`,
    )
    if (data.id != null) this.known.set(`${table} id ${String(data.id)}`, true)
    if (table === 'cards') this.cards.add(String(data.id))
    if (table === 'pages') this.pages.add(String(data.id))
    return true
  }
}

const purgedEntityType = (kind: TrashKind): EntityType => (['project', 'board', 'column', 'card', 'label', 'page'] as const).find((k) => k === kind) ?? 'card'

export function toTrashEntryDTO(row: typeof schema.trash.$inferSelect): TrashEntryDTO {
  return {
    id: row.id,
    kind: row.kind,
    entityId: row.entityId,
    title: row.title,
    location: row.location,
    contents: row.contents,
    bytes: row.bytes,
    deletedBy: {
      kind: row.actorKind,
      id: (row.actorKind === 'agent' ? row.actorTokenId : row.actorUserId) ?? '',
      name: row.actorName,
    },
    deletedAt: row.deletedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }
}
