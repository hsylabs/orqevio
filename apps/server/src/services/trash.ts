import {
  type EntityType,
  MAX_COLUMNS,
  type HistoryMeta,
  type RealtimeEvent,
  type RestoredDTO,
  TRASH_DAYS,
  type TrashContents,
  type TrashKind,
  type TrashNodeDTO,
  type TrashPlanDTO,
  type TrashRestoreInput,
  type TrashTreeDTO,
  type RestoredManyDTO,
  type TrashPlanManyDTO,
  type TrashPurgeSummaryDTO,
  type TrashRestoreManyInput,
  extractReferences,
  trashPurgeManyInput,
  trashRestoreInput,
  trashRestoreManyInput,
  commentExcerpt,
} from '@orqevio/shared'
import { type SQL, and, eq, getTableColumns, lte, sql } from 'drizzle-orm'
import { type SQLiteTable, getTableConfig } from 'drizzle-orm/sqlite-core'
import { type Actor, actorRef } from '../auth/actor'
import type { DbOrTx } from '../db/client'
import * as schema from '../db/schema'
import { AppError, notFound } from '../lib/errors'
import { keyAtEnd } from '../lib/positions'
import { parse } from '../lib/validate'
import type { Access } from './access'
import type { ActivityService } from './activity'
import { safeFilename } from './attachments'
import type { Deps } from './deps'
import type { Change, HistoryService } from './history'
import { deletePageTrees, pageTree } from './pages'
import { type IndexRow, NAME_COLUMN, NAME_MAX, type Node, type Plan, type Ref, TrashIndex, planDTO, planRestore, restoreError } from './trash-tree'

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
  card_comments: schema.cardComments,
  pages: schema.pages,
  card_page_links: schema.cardPageLinks,
  attachments: schema.attachments,
} satisfies Record<string, SQLiteTable>
export type TableName = keyof typeof TABLES
export const ORDER = Object.keys(TABLES) as TableName[]

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
  comment: 'card_comments',
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
  card_comments: 'comments',
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
    this.where('card_comments', sql`card_id IN (${scope})`)
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
    private readonly history: HistoryService,
  ) {}

  /** What restoring the item says in the history of the page or card it belongs to. */
  private restoredChange(tx: DbOrTx, kind: TrashKind, data: Row, meta: HistoryMeta): Change | null {
    const text = (value: unknown) => (typeof value === 'string' ? value : '')
    const id = text(data.id)
    switch (kind) {
      case 'card':
        return { entityType: 'card', entityId: id, kind: 'card.restored', meta }
      case 'page':
        return { entityType: 'page', entityId: id, kind: 'page.restored', meta }
      case 'checklist':
        return { entityType: 'card', entityId: text(data.card_id), kind: 'checklist.restored', subjectId: id, meta: { ...meta, title: text(data.title) } }
      case 'checklist_item': {
        const list = tx.get<{ card_id: string }>(sql`SELECT card_id FROM checklists WHERE id = ${text(data.checklist_id)}`)
        return list ? { entityType: 'card', entityId: list.card_id, kind: 'item.restored', subjectId: id, meta: { ...meta, text: text(data.text) } } : null
      }
      case 'attachment':
        return {
          ...(data.page_id ? { entityType: 'page' as const, entityId: text(data.page_id) } : { entityType: 'card' as const, entityId: text(data.card_id) }),
          kind: 'attachment.restored',
          subjectId: id,
          meta: { ...meta, name: text(data.filename) },
        }
      case 'link': {
        const page = tx.get<{ title: string }>(sql`SELECT title FROM pages WHERE id = ${text(data.page_id)}`)
        return { entityType: 'card', entityId: text(data.card_id), kind: 'card.linked', subjectId: text(data.page_id), meta: { ...meta, page: page?.title ?? '' } }
      }
      case 'comment':
        return { entityType: 'card', entityId: text(data.card_id), kind: 'comment.restored', subjectId: id, meta: { ...meta, text: commentExcerpt(text(data.body)) } }
      default:
        return null
    }
  }

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
      case 'comment': {
        const row = one('card_comments', target.id)
        if (!row) return null
        snapshot.where('card_comments', sql`id = ${target.id}`)
        return { data: snapshot.rows[0]!.data, title: commentExcerpt(String(row.body)), location: cardPath(row.card_id) }
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

  /** What is at the top of the trash: what isn't held by anything else in it. Newest first. */
  async list(actor: Actor, workspaceId: string): Promise<TrashNodeDTO[]> {
    this.access.requireUser(actor)
    await this.access.workspace(actor, workspaceId)
    const index = TrashIndex.load(this.deps.db, workspaceId)
    return index.top().map((node) => index.dto(node))
  }

  /**
   * One thing in the trash, with everything below it and what holds it there; null when it is
   * not in the trash (any more): asking is how the app finds out.
   */
  async tree(actor: Actor, workspaceId: string, key: string): Promise<TrashTreeDTO | null> {
    this.access.requireUser(actor)
    await this.access.workspace(actor, workspaceId)
    const index = TrashIndex.load(this.deps.db, workspaceId)
    const node = index.node(key)
    return node ? index.tree(node) : null
  }

  private async load(actor: Actor, trashId: string) {
    this.access.requireUser(actor)
    const [entry] = await this.deps.db.select().from(schema.trash).where(eq(schema.trash.id, trashId))
    if (!entry) throw notFound('Trash entry')
    await this.access.workspace(actor, entry.workspaceId)
    return entry
  }

  /**
   * Restores something with everything below it but what is left out, where the person says.
   * With `dryRun`, only says what that would do. Without it, it does exactly that, worked out
   * again in the same transaction: if anything is still to decide (where, or names already
   * used there), nothing is done and the plan says what.
   */
  async restoreItem(actor: Actor, workspaceId: string, body: unknown): Promise<TrashPlanDTO | RestoredDTO> {
    this.access.requireUser(actor)
    await this.access.workspace(actor, workspaceId)
    const input: TrashRestoreInput = parse(trashRestoreInput, body)
    if (input.dryRun) {
      const index = TrashIndex.load(this.deps.db, workspaceId)
      return planDTO(index, planRestore(index, input))
    }
    const done = this.deps.db.transaction((tx) => {
      const index = TrashIndex.load(tx, workspaceId)
      const plan = planRestore(index, input)
      if (plan.missing.length) throw new AppError(409, 'restore_incomplete', 'Say where it goes back, and what to do with names already used there, first.', planDTO(index, plan))
      return this.apply(tx, actor, workspaceId, plan)
    })
    await this.announce(actor, workspaceId, done)
    return done.result
  }

  /**
   * Restores several things at once, each as `restoreItem` does, in one transaction: what holds
   * others first, each planned with what the ones before it brought back already there, so the
   * plans say what restoring them together does. One that came back with another (below it, or
   * as the other end of one of its relations) is not asked for twice: `cameWith` says with
   * which. One no longer in the trash is in `missing`. With `dryRun`, or when anything is still to
   * decide for any of them, or one went missing, nothing is done and the plans say what.
   */
  async restoreMany(actor: Actor, workspaceId: string, body: unknown): Promise<TrashPlanManyDTO | RestoredManyDTO> {
    this.access.requireUser(actor)
    await this.access.workspace(actor, workspaceId)
    const input: TrashRestoreManyInput = parse(trashRestoreManyInput, body)
    let answer: TrashPlanManyDTO = { plans: [], ready: false }
    const asked = new Error('only planned')
    let done: Applied[]
    try {
      done = this.deps.db.transaction((tx) => {
        const plans: TrashPlanDTO[] = []
        const cameWith: Record<string, string> = {}
        const applied: Applied[] = []
        const first = TrashIndex.load(tx, workspaceId)
        const missing = input.items.filter((item) => !first.node(item.key)).map((item) => item.key)
        // What holds others first: what is below it comes with it, unless it is left out.
        const depth = (key: string) => first.ancestors(first.node(key)!).length
        const items = input.items.filter((item) => first.node(item.key)).sort((a, b) => depth(a.key) - depth(b.key))
        for (const item of items) {
          // Read again each time: what came back before is there now. Only this batch restores
          // in this transaction, so what was in the trash at first and isn't now came back with it.
          const index = TrashIndex.load(tx, workspaceId)
          const back = (key: string) => first.node(key) !== undefined && !index.node(key)
          if (back(item.key)) continue
          // The other end of a relation that came back already needs no asking for.
          const plan = planRestore(index, { ...item, include: item.include.filter((key) => !back(key)), dryRun: input.dryRun })
          plans.push(planDTO(index, plan))
          if (plan.missing.length) continue
          applied.push(this.apply(tx, actor, workspaceId, plan))
          const after = TrashIndex.load(tx, workspaceId)
          for (const other of items) if (other !== item && index.node(other.key) && !after.node(other.key)) cameWith[other.key] ??= item.key
        }
        answer = { plans, ready: missing.length === 0 && plans.every((p) => p.ready), ...(Object.keys(cameWith).length && { cameWith }), ...(missing.length && { missing }) }
        if (input.dryRun || !answer.ready) throw asked
        return applied
      })
    } catch (error) {
      if (error !== asked) throw error
      if (input.dryRun) return answer
      throw new AppError(409, 'restore_incomplete', 'Say where each goes back, and what to do with names already used there, first.', answer)
    }
    for (const applied of done) await this.announce(actor, workspaceId, applied)
    return { restored: done.map((a) => a.result) }
  }

  /**
   * Puts back exactly what one deletion took away, where it was: what was deleted before on its
   * own stays in the trash. It is what undoing a deletion does, so it never goes anywhere else:
   * when its place is not there, it says so. Names stay as they were.
   */
  async restore(actor: Actor, trashId: string): Promise<RestoredDTO> {
    const entry = await this.load(actor, trashId)
    const done = this.deps.db.transaction((tx) => {
      const results: Applied[] = []
      const seen = new Set<string>()
      for (;;) {
        // Read again each time: what came back before is there now.
        const index = TrashIndex.load(tx, entry.workspaceId)
        const tops = [...index.nodes.values()]
          .filter((n) => n.entry.id === trashId && (!n.parent || n.parent.entry.id !== trashId))
          .sort((a, b) => Number(b.entryRoot) - Number(a.entryRoot) || a.row.rowId - b.row.rowId)
        const top = tops[0]
        if (!top) break
        if (seen.has(top.key)) throw restoreError('restore_changed', 'It could not be put back.')
        seen.add(top.key)
        if (top.place === 'trash') {
          const holder = top.parent!
          throw restoreError('restore_place_in_trash', `Restore “${holder.title}” first: what it belongs to is in the trash too.`, { title: holder.title, key: holder.key })
        }
        if (top.place === 'gone') throw restoreError('restore_place_gone', 'What it belonged to no longer exists.')
        const subtree = index.subtree(top)
        const plan = planRestore(index, {
          key: top.key,
          exclude: subtree.filter((n) => n.entry.id !== trashId).map((n) => n.key),
          to: { kind: 'original' },
          names: {},
          keepNames: subtree.map((n) => n.key),
          include: [],
          dryRun: false,
        })
        if (plan.missing.includes('columns')) throw new AppError(409, 'too_many_columns', `A board holds up to ${MAX_COLUMNS} columns: there is no room to put it back.`)
        if (plan.missing.length) throw restoreError('restore_place_gone', 'What it belonged to no longer exists.')
        // A link goes back between a card and a page: both must be there.
        const waiting = top.kind === 'link' ? plan.wait.find((w) => w.row === top.row) : undefined
        if (waiting) {
          const page = index.node(`page:${top.row.pageId}`)
          throw restoreError('restore_place_in_trash', `Restore “${page?.title ?? ''}” first: the page is in the trash too.`, { title: page?.title ?? '', key: page?.key })
        }
        results.push(this.apply(tx, actor, entry.workspaceId, plan))
      }
      if (!results.length) throw notFound('Trash entry')
      return results
    })
    for (const applied of done) await this.announce(actor, entry.workspaceId, applied)
    const first = done[0]!.result
    return { ...first, kind: entry.kind, entityId: entry.entityId, movedTo: null }
  }

  /** The end of the list of `table`'s rows in `scope`, for something put there now. */
  private atEnd(tx: DbOrTx, table: TableName, scope: SQL) {
    const keys = tx.all<{ position: string }>(sql`SELECT position FROM ${sql.identifier(table)} WHERE ${scope} ORDER BY position`).map((r) => r.position)
    return keyAtEnd(keys)
  }

  /** Applies a plan inside the transaction it was worked out in. */
  private apply(tx: DbOrTx, actor: Actor, workspaceId: string, plan: Plan): Applied {
    const { root } = plan

    // Containers made anew, only for what was in the trash before its place was deleted for good.
    for (const made of plan.create) {
      if (made.kind === 'project') {
        tx.insert(schema.projects)
          .values({ id: made.id, workspaceId, name: made.title.slice(0, NAME_MAX.project), color: 'slate', position: this.atEnd(tx, 'projects', sql`workspace_id = ${workspaceId}`) })
          .run()
      } else if (made.kind === 'page') {
        const projectId = made.in!.id
        tx.insert(schema.pages)
          .values({
            id: made.id,
            workspaceId,
            projectId,
            parentId: null,
            title: made.title.slice(0, NAME_MAX.page),
            position: this.atEnd(tx, 'pages', sql`project_id = ${projectId} AND parent_id IS NULL`),
            createdByUserId: actor.kind === 'user' ? actor.userId : null,
          })
          .run()
      } else {
        const boardId = made.in!.id
        tx.insert(schema.columns)
          .values({ id: made.id, workspaceId, boardId, name: made.title.slice(0, NAME_MAX.column), position: this.atEnd(tx, 'board_columns', sql`board_id = ${boardId}`) })
          .run()
      }
    }

    // The rows as they were kept, with where they go now and their new names.
    const wanted = [...plan.coming.map((n) => n.row.rowId), ...plan.reinsert.map((r) => r.rowId)]
    const kept = new Map<number, Captured>()
    for (let i = 0; i < wanted.length; i += 500) {
      const chunk = wanted.slice(i, i + 500)
      for (const row of tx
        .select({ id: schema.trashRows.id, table: schema.trashRows.tableName, data: schema.trashRows.data })
        .from(schema.trashRows)
        .where(sql`${schema.trashRows.id} IN (SELECT value FROM json_each(${JSON.stringify(chunk)}))`)
        .all()) {
        kept.set(row.id, { table: row.table as TableName, data: row.data as Row })
      }
    }
    const order = new Map(plan.coming.map((n, i) => [n.row.rowId, i]))
    const byRow = new Map(plan.coming.map((n) => [n.row.rowId, n]))
    const rows = wanted
      .map((rowId) => ({ rowId, captured: kept.get(rowId), node: byRow.get(rowId) }))
      .filter((r): r is { rowId: number; captured: Captured; node: Node | undefined } => r.captured !== undefined)
      .sort((a, b) => ORDER.indexOf(a.captured.table) - ORDER.indexOf(b.captured.table) || (order.get(a.rowId) ?? Infinity) - (order.get(b.rowId) ?? Infinity) || a.rowId - b.rowId)
    if (rows.filter((r) => r.node).length !== plan.coming.length) throw restoreError('restore_changed', 'Something in the trash changed meanwhile: look again before restoring.')

    const reinsert = new Reinsert(tx)
    const data = new Map<string, Row>()
    for (const { captured, node } of rows) {
      if (node) {
        const place = plan.placement.get(node.key)
        if (place) {
          Object.assign(captured.data, place.sets)
          const scope = place.moved ? positionScope(node.kind, place.container) : null
          if (scope) captured.data.position = this.atEnd(tx, scope.table, scope.where)
        }
        const name = plan.names.get(node.key)
        const column = NAME_COLUMN[node.kind]
        if (name !== undefined && column) captured.data[column] = node.kind === 'attachment' ? safeFilename(name) : name
        data.set(node.key, captured.data)
        // Planned to fit: if it doesn't, nothing comes back and it all stays in the trash.
        if (!reinsert.insert(captured)) throw restoreError('restore_place_gone', 'It no longer fits where it goes back.')
      } else {
        reinsert.insert(captured)
      }
    }

    // The trash: what came back leaves it; what waits for its other end goes with that.
    const removed = [...plan.coming.map((n) => n.row), ...plan.reinsert, ...plan.drop, ...plan.mentions].map((r) => r.rowId)
    for (let i = 0; i < removed.length; i += 500) {
      tx.delete(schema.trashRows)
        .where(sql`${schema.trashRows.id} IN (SELECT value FROM json_each(${JSON.stringify(removed.slice(i, i + 500))}))`)
        .run()
    }
    for (const { row, trashId } of plan.wait) tx.update(schema.trashRows).set({ trashId }).where(eq(schema.trashRows.id, row.rowId)).run()
    const touched = new Set([...plan.coming.map((n) => n.entry.id), ...[...plan.reinsert, ...plan.drop, ...plan.mentions, ...plan.wait.map((w) => w.row)].map((r) => r.trashId)])
    this.dropEmpty(tx, touched)

    rebuildMentions(tx, workspaceId, reinsert.cards, reinsert.pages)

    // What comes back says so in its history; what goes somewhere else, where.
    const movedTo = plan.to === 'other' || plan.create.length > 0 ? plan.location : null
    for (const node of plan.coming) {
      if (!node.entryRoot) continue
      const change = this.restoredChange(tx, node.kind, data.get(node.key) ?? {}, { trashId: node.entry.id, ...(node === root && movedTo ? { movedTo } : {}) })
      if (change) this.history.record(tx, actor, workspaceId, change)
    }

    const extras = plan.extras.filter((n) => !n.parent || !plan.comingKeys.has(n.parent.key))
    const targets = [root, ...extras].map((node) => ({ node, ...this.target(tx, node, data.get(node.key)) }))
    const main = targets[0]!
    const result: RestoredDTO = {
      kind: root.kind,
      entityId: root.id,
      movedTo,
      path: main.path,
      location: plan.location,
      restored: Math.max(0, plan.coming.length - (data.has(root.key) ? 1 : 0)),
      left: plan.subtree.filter((n) => plan.excluded.has(n.key) && !(n.parent && plan.excluded.has(n.parent.key))).length,
    }
    // A link whose page is in the trash did not come back: it waits for the page, and says so.
    const waiting = root.kind === 'link' && !data.has(root.key)
    if (waiting) result.waitsFor = root.title
    const structure = plan.path.length > 0 || plan.create.length > 0
    return {
      result,
      targets: targets.map((t) => ({ ...t, event: structure ? { ...t.event, structure: true } : t.event })),
      movedTo,
      waiting,
    }
  }

  /** Deletes the entries left with nothing of their own; what else they kept goes with them. */
  private dropEmpty(tx: DbOrTx, trashIds: Iterable<string>) {
    for (const trashId of trashIds) {
      const left = tx.get<{ found: number }>(
        sql`SELECT 1 AS found FROM trash_rows WHERE trash_id = ${trashId} AND (table_name NOT IN ('card_labels', 'card_page_links') OR (table_name = 'card_page_links' AND trash_id IN (SELECT id FROM trash WHERE id = ${trashId} AND kind = 'link'))) LIMIT 1`,
      )
      if (!left) tx.delete(schema.trash).where(eq(schema.trash.id, trashId)).run()
    }
  }

  /** What restoring `node` is about, where to open it, and who hears of it. */
  private target(tx: DbOrTx, node: Node, data: Row | undefined) {
    const text = (value: unknown) => (typeof value === 'string' ? value : '')
    const row = data ?? { id: node.id, card_id: node.row.cardId, page_id: node.row.pageId, board_id: node.row.boardId, project_id: node.row.projectId, checklist_id: node.row.checklistId }
    const id = text(row.id) || node.id
    const boardOfCard = (cardId: string) => tx.get<{ board_id: string }>(sql`SELECT board_id FROM cards WHERE id = ${cardId}`)?.board_id ?? ''
    const onCard = (cardId: string, extra: Omit<RealtimeEvent, 'action' | 'actor' | 'summary'> = {}) => {
      const boardId = boardOfCard(cardId)
      return { entityType: 'card' as EntityType, entityId: cardId, path: boardId ? `b/${boardId}` : null, event: { boardId, cardId, ...extra } }
    }
    switch (node.kind) {
      case 'project':
        return { entityType: 'project' as EntityType, entityId: id, path: `p/${id}`, event: { projectId: id, structure: true } }
      case 'board':
        return { entityType: 'board' as EntityType, entityId: id, path: `b/${id}`, event: { boardId: id, projectId: text(row.project_id), structure: true } }
      case 'column':
        return { entityType: 'column' as EntityType, entityId: id, path: `b/${text(row.board_id)}`, event: { boardId: text(row.board_id), structure: true } }
      case 'card':
        return { entityType: 'card' as EntityType, entityId: id, path: `b/${text(row.board_id)}`, event: { boardId: text(row.board_id), cardId: id, structure: true } }
      case 'page':
        return { entityType: 'page' as EntityType, entityId: id, path: `d/${id}`, event: { pageId: id, projectId: text(row.project_id), structure: true } }
      case 'label':
        return { entityType: 'label' as EntityType, entityId: id, path: `b/${text(row.board_id)}`, event: { boardId: text(row.board_id) } }
      case 'attachment':
        if (row.card_id) return onCard(text(row.card_id))
        return { entityType: 'page' as EntityType, entityId: text(row.page_id), path: `d/${text(row.page_id)}`, event: { pageId: text(row.page_id) } }
      case 'checklist':
        return onCard(text(row.card_id))
      case 'checklist_item': {
        const list = tx.get<{ card_id: string }>(sql`SELECT card_id FROM checklists WHERE id = ${text(row.checklist_id)}`)
        return onCard(list?.card_id ?? '')
      }
      case 'link':
        return onCard(text(row.card_id), { pageId: text(row.page_id) })
      case 'comment':
        return onCard(text(row.card_id))
    }
  }

  /** Records and announces what came back. */
  private async announce(actor: Actor, workspaceId: string, applied: Applied) {
    // Nothing came back of a link that waits for its page: only the trash changed.
    if (applied.waiting && applied.targets.length === 1) {
      await this.activity.emit(workspaceId, { action: 'trash.changed', actor: actorRef(actor), ...applied.targets[0]!.event })
      return
    }
    for (const [i, target] of applied.targets.entries()) {
      if (i === 0 && applied.waiting) continue
      await this.activity.record(
        actor,
        workspaceId,
        {
          action: 'trash.restored',
          entityType: target.entityType,
          entityId: target.entityId,
          summary: target.node.title,
          meta: { kind: target.node.kind, ...(i === 0 && applied.movedTo ? { movedTo: applied.movedTo } : {}) },
        },
        target.event,
      )
    }
  }

  /** Deletes something for good with everything below it, and the files of its attachments. */
  async purgeItem(actor: Actor, workspaceId: string, key: string) {
    this.access.requireUser(actor)
    await this.access.workspace(actor, workspaceId)
    const erased = await this.erase(workspaceId, (index) => {
      const node = index.node(key)
      return node ? [node] : []
    })
    if (!erased) throw notFound('Trash item')
    const [node] = erased
    await this.activity.record(actor, workspaceId, { action: 'trash.purged', entityType: purgedEntityType(node!.kind), entityId: node!.id, summary: node!.title, meta: { kind: node!.kind } })
  }

  /**
   * Deletes several things for good, with everything below them; what is below another one of
   * them goes with it. With `dryRun`, only says how much that takes. What is no longer in the
   * trash is skipped; the answer counts what went.
   */
  async purgeMany(actor: Actor, workspaceId: string, body: unknown): Promise<TrashPurgeSummaryDTO> {
    this.access.requireUser(actor)
    await this.access.workspace(actor, workspaceId)
    const input = parse(trashPurgeManyInput, body)
    const pick = (index: TrashIndex) => index.outermost(input.keys.flatMap((key) => index.node(key) ?? []))
    const summary = (index: TrashIndex, nodes: Node[]): TrashPurgeSummaryDTO => ({ count: nodes.length, ...index.totals(nodes) })
    if (input.dryRun) {
      const index = TrashIndex.load(this.deps.db, workspaceId)
      return summary(index, pick(index))
    }
    let went: TrashPurgeSummaryDTO | null = null
    const erased = await this.erase(workspaceId, (index) => {
      const picked = pick(index)
      went = summary(index, picked)
      return picked
    })
    if (!erased?.length || !went) throw notFound('Trash item')
    for (const node of erased) {
      await this.activity.record(actor, workspaceId, { action: 'trash.purged', entityType: purgedEntityType(node.kind), entityId: node.id, summary: node.title, meta: { kind: node.kind } })
    }
    return went
  }

  /** Deletes for good what one deletion took away, with everything below it. */
  async purge(actor: Actor, trashId: string) {
    const entry = await this.load(actor, trashId)
    // Restored meanwhile: there is nothing left to delete.
    const erased = await this.erase(entry.workspaceId, (index) => [...index.nodes.values()].filter((n) => n.entry.id === trashId), [trashId])
    if (!erased) throw notFound('Trash entry')
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
    const expired = await this.deps.db.select({ id: schema.trash.id, workspaceId: schema.trash.workspaceId }).from(schema.trash).where(lte(schema.trash.expiresAt, now))
    const byWorkspace = new Map<string, string[]>()
    for (const { id, workspaceId } of expired) byWorkspace.set(workspaceId, [...(byWorkspace.get(workspaceId) ?? []), id])
    let erased = 0
    for (const [workspaceId, ids] of byWorkspace) {
      const set = new Set(ids)
      if (await this.erase(workspaceId, (index) => [...index.nodes.values()].filter((n) => set.has(n.entry.id)), ids)) erased += ids.length
    }
    return erased
  }

  /**
   * Deletes for good what `pick` chooses, with everything below it, and then the files of its
   * attachments. Choosing, reading the files and deleting happen in one transaction, so a
   * restore running at the same time either comes first (and nothing of it is erased) or finds
   * nothing to restore. Relations of what goes can never come back: they go too, as do links
   * to a page that goes. Entries left with nothing of their own go, and so do `entries`.
   * Returns what was picked, or null when there was nothing.
   */
  private async erase(workspaceId: string, pick: (index: TrashIndex) => Node[], entries: string[] = []) {
    const done = this.deps.db.transaction((tx) => {
      const index = TrashIndex.load(tx, workspaceId)
      const picked = pick(index)
      // The same as the count shown before: see TrashIndex.goneWith.
      const gone = index.goneWith(picked)
      const has = (kind: string, id: string | null) => gone.has(`${kind}:${id}`)
      const touches = (r: IndexRow) => has('card', r.cardId) || (r.table === 'card_labels' ? has('label', r.labelId) : has('page', r.pageId))
      const rows = [...[...gone.values()].map((n) => n.row), ...index.relations.filter(touches), ...index.mentions.filter(touches)]
      const existing = entries.filter((id) => index.entries.has(id))
      if (rows.length === 0 && existing.length === 0) return null
      // What it held leaves the history too: nothing of it is kept once it is deleted for good.
      this.history.forgetIds(
        tx,
        [...gone.values()].filter((n) => n.kind !== 'link').map((n) => n.id),
      )
      const ids = rows.map((r) => r.rowId)
      for (let i = 0; i < ids.length; i += 500) {
        tx.delete(schema.trashRows)
          .where(sql`${schema.trashRows.id} IN (SELECT value FROM json_each(${JSON.stringify(ids.slice(i, i + 500))}))`)
          .run()
      }
      for (const id of existing) tx.delete(schema.trash).where(eq(schema.trash.id, id)).run()
      this.dropEmpty(tx, new Set(rows.map((r) => r.trashId)))
      return { picked, files: rows.flatMap((r) => (r.table === 'attachments' && r.storageKey ? [r.storageKey] : [])) }
    })
    if (!done) return null
    // A file that fails to go now is left to the hourly sweep: nothing references it any more.
    for (const key of done.files) await this.deps.storage.delete(key).catch(() => {})
    return done.picked.length ? done.picked : entries.length ? ([] as Node[]) : null
  }
}

interface Applied {
  result: RestoredDTO
  /** The item itself waits in the trash for the other end it needs (a link, for its page). */
  waiting: boolean
  targets: { node: Node; entityType: EntityType; entityId: string; path: string | null; event: Omit<RealtimeEvent, 'action' | 'actor' | 'summary'> }[]
  movedTo: string | null
}

/** Where something put somewhere new goes in the order of what is there: at the end. */
function positionScope(kind: TrashKind, container: Ref): { table: TableName; where: SQL } | null {
  switch (kind) {
    case 'board':
      return { table: 'boards', where: sql`project_id = ${container.id}` }
    case 'column':
      return { table: 'board_columns', where: sql`board_id = ${container.id}` }
    case 'card':
      return { table: 'cards', where: sql`column_id = ${container.id}` }
    case 'checklist':
      return { table: 'checklists', where: sql`card_id = ${container.id}` }
    case 'checklist_item':
      return { table: 'checklist_items', where: sql`checklist_id = ${container.id}` }
    case 'page':
      return { table: 'pages', where: container.kind === 'page' ? sql`parent_id = ${container.id}` : sql`project_id = ${container.id} AND parent_id IS NULL` }
    default:
      return null
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
