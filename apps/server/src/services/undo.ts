import {
  type ActorRef,
  type AttachmentPlace,
  type CardPlace,
  HISTORY_BODY_KINDS,
  type HistoryKind,
  type HistoryValue,
  type PagePlace,
  type UndoPlanItemDTO,
  type UndoResultDTO,
  type UndoStatus,
  dueDay,
  undoInput,
} from '@orqevio/shared'
import { type SQL, and, desc, eq, getTableColumns, gt, inArray, or, sql } from 'drizzle-orm'
import type { Actor, UserActor } from '../auth/actor'
import { attachments, cardLabels, cardPageLinks, cards, checklistItems, checklists, columns, history, labels, pages, trash, trashRows } from '../db/schema'
import { AppError, badRequest, notFound } from '../lib/errors'
import { parse } from '../lib/validate'
import type { Access } from './access'
import type { AttachmentService } from './attachments'
import type { CardService } from './cards'
import type { Deps } from './deps'
import { type HistoryRow, decode } from './history'
import { MAX_TREE_DEPTH, type PageService } from './pages'
import type { TrashService } from './trash'

/** The end of a column or of a list of subpages, where something moved back goes. */
const AT_END = 100_000
/** The most changes one request undoes, the newest ones. */
const MAX_CHANGES = 500
/** Ids per query: a Cloudflare Durable Object takes at most 100 bound values in one. */
const CHUNK = 90

type Row = HistoryRow & { seq: number }

/** An entry without its long texts: a bulk undo never holds hundreds of them in memory at once. */
const LIGHT_COLUMNS = (() => {
  const body = inArray(history.kind, [...HISTORY_BODY_KINDS])
  return {
    ...getTableColumns(history),
    before: sql<string | null>`CASE WHEN ${body} THEN NULL ELSE ${history.before} END`,
    after: sql<string | null>`CASE WHEN ${body} THEN NULL ELSE ${history.after} END`,
    seq: sql<number>`rowid`,
  }
})()

interface Check {
  status: UndoStatus
  reason?: UndoPlanItemDTO['reason']
  trashKey?: string
  current?: HistoryValue
  /** For a conflict found on something else than the change itself: who made the newer change. */
  by?: ActorRef | null
  /** For a change that brings something back or takes it away: what it is about exists afterwards. */
  exists?: boolean
}

/**
 * What is true now, plus what undoing the newer changes of the same batch will have done by
 * the time an older one is undone: a plan reads them newest first, as they are undone.
 */
class State {
  readonly values = new Map<string, HistoryValue>()
  readonly exists = new Map<string, boolean>()
  /** For long texts: the change whose text before will be the text by then (compared in SQLite, never loaded). */
  readonly bodies = new Map<string, string>()
  /** Trash entries the newer changes bring back, with everything they hold. */
  readonly restoring = new Set<string>()
}

const fieldKey = (row: HistoryRow) => `${row.entityId}|${row.kind}|${row.subjectId ?? ''}`
const sameSet = (a: HistoryValue, b: HistoryValue) =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]) : a === b
/**
 * Two due dates are the same when they name the same day. Older versions kept the time a date was
 * sent with; now it is the day at 12:00 UTC, so an older value and the one undoing sets agree.
 */
const sameDue = (a: HistoryValue, b: HistoryValue) => {
  const day = (v: HistoryValue) => (typeof v === 'string' ? (dueDay(v) ?? v) : v)
  return day(a) === day(b)
}
const columnOf = (value: HistoryValue) => (value && typeof value === 'object' && !Array.isArray(value) && 'columnId' in value ? (value as CardPlace).columnId : null)
const fileAt = (value: HistoryValue) =>
  value && typeof value === 'object' && !Array.isArray(value) && 'pageId' in value ? `${(value as AttachmentPlace).cardId ?? ''}|${(value as AttachmentPlace).pageId ?? ''}` : null
const parentOf = (value: HistoryValue) => (value && typeof value === 'object' && !Array.isArray(value) && 'projectId' in value ? (value as PagePlace).parentId : undefined)

/**
 * Undoes changes from the history, as `git revert` does: each goes back to how it was before,
 * without touching what changed after it. Only people undo. A change someone changed again
 * since is a conflict: they choose to skip it or undo it anyway. Undoing is itself a change,
 * recorded in the history like any other.
 */
export class UndoService {
  constructor(
    private readonly deps: Deps,
    private readonly access: Access,
    private readonly services: { cards: CardService; pages: PageService; attachments: AttachmentService; trash: TrashService },
  ) {}

  async undo(actor: Actor, input: unknown): Promise<UndoResultDTO> {
    this.access.requireUser(actor)
    const data = parse(undoInput, input)
    const rows = await this.entries(actor, data.ids, data.since)
    const undoing = new Set(rows.map((r) => r.id))

    // The plan, before anything changes.
    const state = new State()
    const plan = rows.map((row) => this.planItem(row, this.check(row, undoing, state), undoing, state))
    if (data.dryRun || (data.conflicts === 'ask' && plan.some((p) => p.status === 'conflict'))) return { applied: false, plan, undone: 0, skipped: 0, failed: 0 }

    // Newest first, each checked again against what is true by then.
    let undone = 0
    let skipped = 0
    let failed = 0
    for (const [i, row] of rows.entries()) {
      const check = this.check(row, undoing, new State())
      const item = this.planItem(row, check, undoing)
      plan[i] = item
      if (check.status === 'unchanged') continue
      if (check.status === 'impossible') {
        failed++
        continue
      }
      if (check.status === 'conflict' && data.conflicts !== 'force') {
        skipped++
        continue
      }
      try {
        await this.apply(row, { ...actor, note: { undoOf: row.id } })
        undone++
      } catch (error) {
        if (!(error instanceof AppError)) throw error
        plan[i] = { ...item, status: 'impossible', reason: 'refused' }
        failed++
      }
    }
    return { applied: true, plan, undone, skipped, failed }
  }

  /** Puts a page's content or a card's description back as it was after a change, as a new change. */
  async restoreVersion(actor: Actor, entryId: string) {
    this.access.requireUser(actor)
    const [row] = await this.deps.db.select().from(history).where(eq(history.id, entryId))
    if (!row) throw notFound('History entry')
    await this.access.workspace(actor, row.workspaceId)
    if (!HISTORY_BODY_KINDS.has(row.kind)) throw badRequest('Only versions of a content or a description can be restored')
    const text = row.after ?? ''
    const by: UserActor = { ...actor, note: { restoredFrom: row.id } }
    if (row.kind === 'page.content') {
      const page = this.deps.db.select({ version: pages.version }).from(pages).where(eq(pages.id, row.entityId)).get()
      if (!page) throw notFound('Page')
      await this.services.pages.update(by, row.entityId, { content: text, baseVersion: page.version })
    } else {
      const card = this.deps.db.select({ version: cards.version }).from(cards).where(eq(cards.id, row.entityId)).get()
      if (!card) throw notFound('Card')
      await this.services.cards.update(by, row.entityId, { description: text, baseVersion: card.version })
    }
  }

  private rows(where: SQL | undefined) {
    return this.deps.db
      .select(LIGHT_COLUMNS)
      .from(history)
      .where(where)
      .orderBy(desc(history.updatedAt), desc(sql`rowid`))
  }

  /** The changes to undo, newest first: those asked for, or all their author did from one on. */
  private async entries(actor: Actor, ids: string[] | undefined, since: string | undefined): Promise<Row[]> {
    let rows: Row[] = []
    if (ids) {
      for (let i = 0; i < ids.length; i += CHUNK) rows.push(...(await this.rows(inArray(history.id, ids.slice(i, i + CHUNK)))))
      if (rows.length !== new Set(ids).size) throw notFound('History entry')
      rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.seq - a.seq)
    } else {
      const [anchor] = await this.rows(eq(history.id, since!))
      if (!anchor) throw notFound('History entry')
      const author = anchor.actorKind === 'agent' ? eq(history.actorTokenId, anchor.actorTokenId ?? '') : and(eq(history.actorKind, 'user'), eq(history.actorUserId, anchor.actorUserId ?? ''))
      const from = or(gt(history.updatedAt, anchor.updatedAt), and(eq(history.updatedAt, anchor.updatedAt), sql`rowid >= ${anchor.seq}`))
      rows = await this.rows(and(eq(history.workspaceId, anchor.workspaceId), author, from)).limit(MAX_CHANGES)
    }
    for (const workspaceId of new Set(rows.map((r) => r.workspaceId))) await this.access.workspace(actor, workspaceId)
    return rows
  }

  private planItem(row: Row, check: Check, undoing: Set<string>, state?: State): UndoPlanItemDTO {
    const table = row.entityType === 'page' ? pages : cards
    // In the trash, its title is where it was kept.
    const trashed = typeof row.meta.trashId === 'string' ? [row.meta.trashId, ...(state?.restoring ?? [])] : [...(state?.restoring ?? [])]
    const title =
      this.deps.db.select({ title: table.title }).from(table).where(eq(table.id, row.entityId)).get()?.title ??
      trashed.map((trashId) => this.kept(trashId, row.entityId)?.title).find((t) => typeof t === 'string')
    return {
      entryId: row.id,
      kind: row.kind,
      entityType: row.entityType,
      entityId: row.entityId,
      entityTitle: title ?? (typeof row.meta.title === 'string' ? row.meta.title : ''),
      status: check.status,
      ...(check.reason ? { reason: check.reason } : {}),
      ...(check.trashKey ? { trashKey: check.trashKey } : {}),
      ...(check.status === 'conflict' ? { changedBy: check.by !== undefined ? check.by : this.changedSince(row, check.exists === undefined, undoing, state), current: check.current ?? null } : {}),
    }
  }

  /**
   * What counts as changing the same thing after this change: the same value for a value; for
   * a page or a card made or brought back, anything on it; for a checklist, anything on it and
   * its items; for an item, a file or a link, anything on that. What is under it counts as it will
   * be by then (`state`): there, or coming back from the trash, and where newer undone moves put it.
   */
  private sameThing(row: HistoryRow, isValue: boolean, state?: State) {
    if (isValue) return and(eq(history.entityId, row.entityId), eq(history.kind, row.kind), row.subjectId ? eq(history.subjectId, row.subjectId) : undefined)
    // Bound as one value: a Cloudflare Durable Object takes at most 100 in one query.
    const kept = (table: string) => sql`SELECT data FROM trash_rows WHERE table_name = ${table} AND trash_id IN (SELECT value FROM json_each(${JSON.stringify([...(state?.restoring ?? [])])}))`
    // A page goes to the trash with its subpages and the links of cards to them: what happened
    // under it counts too, and so does linking a card to it (recorded on the card).
    if (row.entityType === 'page' && !row.subjectId) {
      // Pages that newer undone moves (or restoring) put under another parent are under it by then.
      const moved: Record<string, string | null> = {}
      for (const [key, value] of state?.values ?? []) {
        const match = /^(.+)\|page\.moved\|$/.exec(key)
        const parent = parentOf(value)
        if (match && parent !== undefined) moved[match[1]!] = parent
      }
      const elsewhere = sql`(SELECT key FROM json_each(${JSON.stringify(moved)}))`
      // Pages that newer undone changes take away are gone by then, with what is under them.
      const absent = [...(state?.exists ?? [])].filter(([key, there]) => !there && key.startsWith('page:')).map(([key]) => key.slice('page:'.length))
      const gone = sql`(SELECT value FROM json_each(${JSON.stringify(absent)}))`
      const tree = sql`WITH RECURSIVE tree(id, depth) AS (
        SELECT ${row.entityId}, 0
        UNION ALL SELECT p.id, t.depth + 1 FROM pages p JOIN tree t ON p.parent_id = t.id WHERE t.depth < ${MAX_TREE_DEPTH} AND p.id NOT IN ${elsewhere} AND p.id NOT IN ${gone}
        UNION ALL SELECT m.key, t.depth + 1 FROM json_each(${JSON.stringify(moved)}) m JOIN tree t ON m.value = t.id WHERE t.depth < ${MAX_TREE_DEPTH} AND m.key NOT IN ${gone}
        UNION ALL SELECT json_extract(k.data, '$.id'), t.depth + 1 FROM (${kept('pages')}) k JOIN tree t ON json_extract(k.data, '$.parent_id') = t.id
          WHERE t.depth < ${MAX_TREE_DEPTH} AND json_extract(k.data, '$.id') NOT IN ${elsewhere} AND json_extract(k.data, '$.id') NOT IN ${gone}
      ) SELECT id FROM tree`
      return or(sql`${history.entityId} IN (${tree})`, sql`${history.subjectId} IN (${tree})`)
    }
    if (!row.subjectId) return eq(history.entityId, row.entityId)
    // A file can change places: what happened to it anywhere counts.
    if (row.kind.startsWith('attachment.')) return eq(history.subjectId, row.subjectId)
    if (!row.kind.startsWith('checklist.')) return and(eq(history.entityId, row.entityId), eq(history.subjectId, row.subjectId))
    // A checklist goes with all its items, however many.
    return and(
      eq(history.entityId, row.entityId),
      or(
        eq(history.subjectId, row.subjectId),
        sql`${history.subjectId} IN (SELECT id FROM checklist_items WHERE checklist_id = ${row.subjectId})`,
        sql`${history.subjectId} IN (SELECT json_extract(k.data, '$.id') FROM (${kept('checklist_items')}) k WHERE json_extract(k.data, '$.checklist_id') = ${row.subjectId})`,
      ),
    )
  }

  /**
   * The changes made to the same thing after this one, newest first, besides those undone with
   * it. For something made or brought back, only someone else's count: its author's own later
   * changes go with it.
   */
  private laterChanges(row: Row, isValue: boolean, undoing: Set<string>, state?: State) {
    const author = (r: { kind: string; userId: string | null; tokenId: string | null }) => (r.kind === 'agent' ? `agent:${r.tokenId}` : `user:${r.userId}`)
    const own = author({ kind: row.actorKind, userId: row.actorUserId, tokenId: row.actorTokenId })
    return this.deps.db
      .select({ id: history.id, kind: history.actorKind, userId: history.actorUserId, tokenId: history.actorTokenId, name: history.actorName, meta: history.meta })
      .from(history)
      // After it: later, or in the same millisecond but recorded after it.
      .where(and(this.sameThing(row, isValue, state), or(gt(history.updatedAt, row.updatedAt), and(eq(history.updatedAt, row.updatedAt), sql`rowid > ${row.seq}`))))
      .orderBy(desc(history.updatedAt), desc(sql`rowid`))
      .all()
      // Undoing the newer changes of the same batch records changes too: they don't count either.
      .filter((r) => !undoing.has(r.id) && !undoing.has(String(r.meta.undoOf)) && (isValue || author(r) !== own))
  }

  /** Who changed it after this change, besides the changes being undone with it. */
  private changedSince(row: Row, isValue: boolean, undoing: Set<string>, state?: State): ActorRef | null {
    const [later] = this.laterChanges(row, isValue, undoing, state)
    return later ? { kind: later.kind, id: (later.kind === 'agent' ? later.tokenId : later.userId) ?? '', name: later.name } : null
  }

  /** What a trash entry keeps of one thing it holds, if it holds it. */
  private kept(trashId: string, id: string) {
    const found = this.deps.db
      .select({ data: trashRows.data })
      .from(trashRows)
      .where(and(eq(trashRows.trashId, trashId), sql`json_extract(${trashRows.data}, '$.id') = ${id}`))
      .get()
    return found?.data as { title?: string } | undefined
  }

  /**
   * The rows of `table` that the trash entries being brought back keep, where `column` is
   * `value`: what they will be once back. Without their long texts, compared where they are kept.
   */
  private keptRows(restoring: Set<string>, table: string, column: string, value: string) {
    const ids = [...restoring]
    const found: { trashId: string; data: Record<string, unknown> }[] = []
    for (let i = 0; i < ids.length; i += CHUNK) {
      const rows = this.deps.db
        .select({ trashId: trashRows.trashId, data: sql<string>`json_remove(${trashRows.data}, '$.content', '$.description')` })
        .from(trashRows)
        .where(and(inArray(trashRows.trashId, ids.slice(i, i + CHUNK)), eq(trashRows.tableName, table), sql`json_extract(${trashRows.data}, ${`$.${column}`}) = ${value}`))
        .all()
      found.push(...rows.map((r) => ({ trashId: r.trashId, data: JSON.parse(r.data) as Record<string, unknown> })))
    }
    return found
  }

  private trashed(row: HistoryRow) {
    const id = typeof row.meta.trashId === 'string' ? row.meta.trashId : null
    return id !== null && Boolean(this.deps.db.select({ id: trash.id }).from(trash).where(eq(trash.id, id)).get())
  }

  /** The key of `kind:id` in this workspace's trash, when it is there. */
  private inTrash(workspaceId: string, kind: 'project' | 'column' | 'page' | 'card', id: string | null) {
    if (!id) return null
    const table = { project: 'projects', column: 'board_columns', page: 'pages', card: 'cards' }[kind]
    const found = this.deps.db.get<{ found: number }>(
      sql`SELECT 1 AS found FROM trash_rows r JOIN trash t ON t.id = r.trash_id WHERE t.workspace_id = ${workspaceId} AND r.table_name = ${table} AND json_extract(r.data, '$.id') = ${id} LIMIT 1`,
    )
    return found ? `${kind}:${id}` : null
  }

  /**
   * Whether the page or card a deletion took away can go back where it was: undoing never puts
   * it anywhere else. Its place is there, or comes back with the newer changes being undone
   * (`state.restoring`); a card follows its column if that went to another board. Otherwise:
   * that place is in the trash (with its key there) or gone for good.
   */
  private returnPlace(row: Row, state: State): CardPlace | { reason: 'place_in_trash'; trashKey: string } | { reason: 'place_gone' } | undefined {
    const db = this.deps.db
    const trashId = typeof row.meta.trashId === 'string' ? row.meta.trashId : ''
    const [kept] = this.keptRows(new Set([trashId]), row.entityType === 'page' ? 'pages' : 'cards', 'id', row.entityId)
    if (!kept) return undefined
    const data = kept.data
    const missing = (kind: 'project' | 'column' | 'page', id: string | null) => {
      const trashKey = this.inTrash(row.workspaceId, kind, id)
      return trashKey ? { reason: 'place_in_trash' as const, trashKey } : { reason: 'place_gone' as const }
    }
    if (row.entityType === 'page') {
      const parentId = data.parent_id == null ? null : String(data.parent_id)
      if (parentId !== null) {
        const there = Boolean(db.get(sql`SELECT 1 AS found FROM pages WHERE id = ${parentId}`)) || this.keptRows(state.restoring, 'pages', 'id', parentId).length > 0
        return there ? undefined : missing('page', parentId)
      }
      const projectId = String(data.project_id)
      return db.get(sql`SELECT 1 AS found FROM projects WHERE id = ${projectId}`) ? undefined : missing('project', projectId)
    }
    const columnId = String(data.column_id)
    const column = db.get<{ board_id: string }>(sql`SELECT board_id FROM board_columns WHERE id = ${columnId}`)
    if (!column) return missing('column', columnId)
    return column.board_id === data.board_id ? undefined : { boardId: column.board_id, columnId }
  }

  /** How undoing this change stands, against `state`: now, and after the newer changes being undone. */
  private check(row: Row, undoing: Set<string>, state: State): Check {
    const db = this.deps.db
    const kind = row.kind
    const before = decode(kind, row.before)
    const after = decode(kind, row.after)
    const subject = row.subjectId ?? ''
    const one = <T>(query: { get: () => T | undefined }) => query.get()
    const has = (key: string, real: () => boolean) => state.exists.get(key) ?? real()
    // Not there now, but undoing a newer change brings it back from the trash, as it was kept there.
    const returning = (id: string) => [...state.restoring].some((trashId) => this.kept(trashId, id) !== undefined)
    const kept = (table: string, id: string, column = 'id') => this.keptRows(state.restoring, table, column, id)
    const text = (v: unknown) => (v == null ? null : String(v))
    const date = (v: unknown) => (v == null ? null : new Date(Number(v)))
    const entityKey = `${row.entityType}:${row.entityId}`
    // There, or coming back with something a newer change being undone brings back (a subpage with its page).
    const entityExists = has(
      entityKey,
      () =>
        Boolean(row.entityType === 'page' ? one(db.select({ id: pages.id }).from(pages).where(eq(pages.id, row.entityId))) : one(db.select({ id: cards.id }).from(cards).where(eq(cards.id, row.entityId)))) ||
        returning(row.entityId),
    )

    // Something taken away (to the trash) comes back; something added goes.
    const bringBack = (key: string, real: () => boolean): Check => {
      if (has(key, real)) return { status: 'unchanged' }
      if (!this.trashed(row)) return { status: 'impossible', reason: 'trash_gone' }
      state.exists.set(key, true)
      state.restoring.add(String(row.meta.trashId))
      return { status: 'ready', exists: true }
    }
    const takeAway = (key: string, real: () => boolean): Check => {
      if (!has(key, real)) return { status: 'unchanged' }
      const status = this.laterChanges(row, false, undoing, state).length ? 'conflict' : 'ready'
      if (status === 'ready') state.exists.set(key, false)
      return { status, exists: false }
    }
    // A value set back to what it was before, or to `back`: what of it undoing can still set.
    const value = (
      current: HistoryValue,
      same: (a: HistoryValue, b: HistoryValue) => boolean = (a, b) => a === b,
      place?: () => boolean,
      key = fieldKey(row),
      back: HistoryValue = before,
      /** Where the old place is in the trash, when it is: its key there. */
      inTrash?: () => string | null,
    ): Check => {
      const now = state.values.has(key) ? state.values.get(key)! : current
      if (same(now, back)) return { status: 'unchanged' }
      if (place && !place()) {
        const trashKey = inTrash?.()
        return trashKey ? { status: 'impossible', reason: 'place_in_trash', trashKey } : { status: 'impossible', reason: 'place_gone' }
      }
      const status = same(now, after) ? 'ready' : 'conflict'
      if (status === 'ready') state.values.set(key, back)
      return { status, current: now }
    }

    // A long text, compared in SQLite with the change's texts, which stay out of memory. For
    // something coming back from the trash, the text kept there.
    const body = (table: 'pages' | 'cards', column: 'content' | 'description', trashId?: string): Check => {
      const key = fieldKey(row)
      const ref = state.bodies.get(key)
      const now = ref
        ? sql`(SELECT "before" FROM history WHERE id = ${ref})`
        : trashId
          ? sql`(SELECT json_extract(data, ${`$.${column}`}) FROM trash_rows WHERE trash_id = ${trashId} AND table_name = ${table} AND json_extract(data, '$.id') = ${row.entityId})`
          : sql`(SELECT ${sql.identifier(column)} FROM ${sql.identifier(table)} WHERE id = ${row.entityId})`
      const found = db.get<{ isBefore: number; isAfter: number; current: string | null }>(
        sql`SELECT ${now} IS h."before" AS isBefore, ${now} IS h."after" AS isAfter, substr(${now}, 1, 200) AS current FROM history h WHERE h.id = ${row.id}`,
      )
      if (!found) return { status: 'impossible', reason: 'gone' }
      if (found.isBefore) return { status: 'unchanged' }
      if (!found.isAfter) return { status: 'conflict', current: found.current }
      state.bodies.set(key, row.id)
      return { status: 'ready' }
    }

    switch (kind) {
      case 'page.deleted':
      case 'card.deleted': {
        if (has(entityKey, () => entityExists)) return { status: 'unchanged' }
        // Where it goes back: where it was, and nowhere else.
        const place = this.returnPlace(row, state)
        if (place && 'reason' in place) return { status: 'impossible', ...place }
        const check = bringBack(entityKey, () => entityExists)
        if (check.status === 'ready' && place) state.values.set(`${row.entityId}|${row.entityType}.moved|`, place)
        return check
      }
      case 'page.created':
      case 'page.restored':
      case 'card.created':
      case 'card.restored':
        return takeAway(entityKey, () => entityExists)
    }
    // Files, on a page or a card: what matters is the file. One made or brought back goes from
    // wherever it is now, even if the place it was made in is gone.
    const file = () => Boolean(one(db.select({ id: attachments.id }).from(attachments).where(eq(attachments.id, subject))))
    if (kind === 'attachment.created' || kind === 'attachment.restored') return takeAway(`attachment:${subject}`, () => file() || returning(subject))
    if (!entityExists) return { status: 'impossible', reason: 'gone' }

    switch (kind) {
      case 'attachment.deleted':
        return bringBack(`attachment:${subject}`, file)
      case 'attachment.moved': {
        const keptFile = () => kept('attachments', subject).map(({ data }) => ({ cardId: text(data.card_id), pageId: text(data.page_id), workspaceId: String(data.workspace_id) }))[0]
        const at = one(db.select({ cardId: attachments.cardId, pageId: attachments.pageId, workspaceId: attachments.workspaceId }).from(attachments).where(eq(attachments.id, subject))) ?? keptFile()
        if (!at) return { status: 'impossible', reason: 'gone' }
        const key = `attachment-place:${subject}`
        const back = before as AttachmentPlace | null
        // Its old place: there, or coming back from the trash first.
        const there = () => {
          const table = back?.pageId ? pages : cards
          const id = back?.pageId ?? back?.cardId ?? ''
          return (
            Boolean(one(db.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.workspaceId, at.workspaceId))))) ||
            kept(back?.pageId ? 'pages' : 'cards', id).some(({ data }) => data.workspace_id === at.workspaceId)
          )
        }
        // One move, in the history of both places: keyed by the file, so undoing both entries moves it once.
        return value({ cardId: at.cardId, pageId: at.pageId }, (a, b) => fileAt(a) === fileAt(b), there, key, before, () =>
          this.inTrash(row.workspaceId, back?.pageId ? 'page' : 'card', back?.pageId ?? back?.cardId ?? null),
        )
      }
    }

    if (row.entityType === 'page') {
      const live = one(db.select({ title: pages.title, icon: pages.icon, parentId: pages.parentId, projectId: pages.projectId }).from(pages).where(eq(pages.id, row.entityId)))
      const [back] = live ? [] : kept('pages', row.entityId)
      const page = live ?? (back && { title: String(back.data.title), icon: text(back.data.icon), parentId: text(back.data.parent_id), projectId: String(back.data.project_id) })
      if (!page) return { status: 'impossible', reason: 'gone' }
      switch (kind) {
        case 'page.title':
          return value(page.title)
        case 'page.icon':
          return value(page.icon)
        case 'page.content':
          return body('pages', 'content', back?.trashId)
        case 'page.moved': {
          const target = parentOf(before)
          return value(
            { projectId: page.projectId, parentId: page.parentId },
            (a, b) => parentOf(a) === parentOf(b),
            // Its old parent: there, or coming back from the trash first.
            () =>
              target === null ||
              Boolean(one(db.select({ id: pages.id }).from(pages).where(and(eq(pages.id, target ?? ''), eq(pages.projectId, page.projectId))))) ||
              kept('pages', target ?? '').some(({ data }) => data.project_id === page.projectId),
            fieldKey(row),
            before,
            () => this.inTrash(row.workspaceId, 'page', target ?? null),
          )
        }
      }
    } else {
      const live = one(
        db
          .select({ id: cards.id, title: cards.title, boardId: cards.boardId, columnId: cards.columnId, workspaceId: cards.workspaceId, dueAt: cards.dueAt, archivedAt: cards.archivedAt })
          .from(cards)
          .where(eq(cards.id, row.entityId)),
      )
      const [back] = live ? [] : kept('cards', row.entityId)
      const card = live ?? (back && {
        id: row.entityId,
        title: String(back.data.title),
        boardId: String(back.data.board_id),
        columnId: String(back.data.column_id),
        workspaceId: String(back.data.workspace_id),
        dueAt: date(back.data.due_at),
        archivedAt: date(back.data.archived_at),
      })
      if (!card) return { status: 'impossible', reason: 'gone' }
      // Its labels, links, checklists and items: there, or coming back with it.
      const labelIds = () => {
        if (live) return db.select({ id: cardLabels.labelId }).from(cardLabels).where(eq(cardLabels.cardId, card.id)).all().map((l) => l.id)
        // Back from the trash, it keeps only those of its labels on the board it goes back to.
        const ids = kept('card_labels', card.id, 'card_id').map(({ data }) => String(data.label_id))
        if (!ids.length) return []
        const board = (state.values.get(`${card.id}|card.moved|`) as CardPlace | undefined)?.boardId ?? card.boardId
        return db
          .select({ id: labels.id })
          .from(labels)
          .where(and(eq(labels.boardId, board), sql`${labels.id} IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`))
          .all()
          .map((l) => l.id)
      }
      switch (kind) {
        case 'card.title':
          return value(card.title)
        case 'card.description':
          return body('cards', 'description', back?.trashId)
        case 'card.due':
          return value(card.dueAt?.toISOString() ?? null, sameDue)
        case 'card.labels': {
          // Labels deleted from its board since can't go back on: undoing it sets the others.
          const wanted = Array.isArray(before) ? before.map(String) : []
          const place = state.values.get(`${card.id}|card.moved|`) as CardPlace | undefined
          const board = place?.boardId ?? card.boardId
          const still = wanted.length
            ? db
                .select({ id: labels.id })
                .from(labels)
                .where(and(eq(labels.boardId, board), sql`${labels.id} IN (SELECT value FROM json_each(${JSON.stringify(wanted)}))`))
                .all()
                .map((l) => l.id)
            : []
          return value(labelIds(), sameSet, undefined, fieldKey(row), wanted.filter((id) => still.includes(id)))
        }
        case 'card.moved': {
          const target = columnOf(before)
          const key = fieldKey(row)
          const had = state.values.get(key)
          const place = (state.values.has(key) ? had : { boardId: card.boardId, columnId: card.columnId }) as CardPlace
          // Its labels by then, on the board it is on before this move is undone.
          const labelKey = `${card.id}|card.labels|`
          const labelsNow = state.values.has(labelKey) ? state.values.get(labelKey) : labelIds()
          const check = value(
            { boardId: card.boardId, columnId: card.columnId },
            (a, b) => columnOf(a) === columnOf(b),
            // Its old column, on its board or another one of the same workspace.
            () => Boolean(one(db.select({ id: columns.id }).from(columns).where(and(eq(columns.id, target ?? ''), eq(columns.workspaceId, card.workspaceId))))),
            key,
            before,
            () => this.inTrash(row.workspaceId, 'column', target ?? null),
          )
          // Back to another board, it leaves the labels it has on this one: newer labels are a conflict.
          const toOtherBoard = (before as CardPlace | null)?.boardId !== undefined && (before as CardPlace).boardId !== place.boardId
          if (check.status !== 'ready' || !toOtherBoard) return check
          if (!Array.isArray(labelsNow) || labelsNow.length === 0) {
            // Back there, it gets again the labels it lost on the way, those still on that board:
            // older label changes are checked against them, as when they are undone.
            const lost = Array.isArray(row.meta.labelIds) ? row.meta.labelIds : []
            const back = lost.length ? db.select({ id: labels.id }).from(labels).where(and(eq(labels.boardId, (before as CardPlace).boardId), inArray(labels.id, lost))).all().map((l) => l.id) : []
            state.values.set(labelKey, back)
            return check
          }
          if (had === undefined) state.values.delete(key)
          else state.values.set(key, had)
          const [who] = this.laterChanges({ ...row, kind: 'card.labels', subjectId: null }, true, undoing)
          return { status: 'conflict', current: labelsNow, by: who ? { kind: who.kind, id: (who.kind === 'agent' ? who.tokenId : who.userId) ?? '', name: who.name } : null }
        }
        case 'card.archived':
          return value(card.archivedAt !== null)
        case 'card.linked':
        case 'card.unlinked': {
          const link = () =>
            Boolean(one(db.select({ id: cardPageLinks.pageId }).from(cardPageLinks).where(and(eq(cardPageLinks.cardId, card.id), eq(cardPageLinks.pageId, subject), eq(cardPageLinks.source, 'manual'))))) ||
            kept('card_page_links', card.id, 'card_id').some(({ data }) => data.page_id === subject && data.source === 'manual')
          return kind === 'card.linked' ? takeAway(`link:${card.id}:${subject}`, link) : bringBack(`link:${card.id}:${subject}`, link)
        }
      }
      const checklist = () =>
        one(db.select({ title: checklists.title }).from(checklists).where(and(eq(checklists.id, subject), eq(checklists.cardId, card.id)))) ??
        kept('checklists', subject).filter(({ data }) => data.card_id === card.id).map(({ data }) => ({ title: String(data.title) }))[0]
      const item = () =>
        one(db.select({ text: checklistItems.text, done: checklistItems.done }).from(checklistItems).where(eq(checklistItems.id, subject))) ??
        kept('checklist_items', subject).map(({ data }) => ({ text: String(data.text), done: Boolean(data.done) }))[0]
      switch (kind) {
        case 'checklist.created':
        case 'checklist.restored':
          return takeAway(`checklist:${subject}`, () => Boolean(checklist()) || returning(subject))
        case 'checklist.deleted':
          return bringBack(`checklist:${subject}`, () => Boolean(checklist()))
        case 'checklist.title': {
          const list = checklist()
          return list ? value(list.title) : { status: 'impossible', reason: 'gone' }
        }
        case 'item.created':
        case 'item.restored':
          return takeAway(`item:${subject}`, () => Boolean(item()) || returning(subject))
        case 'item.deleted':
          return bringBack(`item:${subject}`, () => Boolean(item()))
        case 'item.text':
        case 'item.done': {
          const it = item()
          return it ? value(kind === 'item.text' ? it.text : it.done) : { status: 'impossible', reason: 'gone' }
        }
      }
    }
    return { status: 'impossible', reason: 'refused' }
  }

  /** Undoes one change, through the services that make changes, so it is checked and recorded as any other. */
  private async apply(row: HistoryRow, actor: UserActor) {
    const { cards: cardService, pages: pageService, attachments: attachmentService, trash: trashService } = this.services
    const kind: HistoryKind = row.kind
    // Long texts are read one at a time, as each is undone.
    const raw = HISTORY_BODY_KINDS.has(kind) ? (this.deps.db.get<{ text: string | null }>(sql`SELECT "before" AS text FROM history WHERE id = ${row.id}`)?.text ?? null) : row.before
    const before = decode(kind, raw)
    const subject = row.subjectId ?? ''
    const trashId = typeof row.meta.trashId === 'string' ? row.meta.trashId : ''
    const db = this.deps.db
    switch (kind) {
      case 'page.title':
        return pageService.update(actor, row.entityId, { title: String(before ?? '') })
      case 'page.icon':
        return pageService.update(actor, row.entityId, { icon: before === null ? null : String(before) })
      case 'page.content': {
        const page = db.select({ version: pages.version }).from(pages).where(eq(pages.id, row.entityId)).get()
        return pageService.update(actor, row.entityId, { content: String(before ?? ''), baseVersion: page?.version })
      }
      case 'page.moved':
        return pageService.move(actor, row.entityId, { parentId: parentOf(before) ?? null, index: AT_END })
      case 'page.created':
      case 'page.restored':
        return pageService.remove(actor, row.entityId)
      case 'card.title':
        return cardService.update(actor, row.entityId, { title: String(before ?? '') })
      case 'card.description': {
        const card = db.select({ version: cards.version }).from(cards).where(eq(cards.id, row.entityId)).get()
        return cardService.update(actor, row.entityId, { description: String(before ?? ''), baseVersion: card?.version })
      }
      case 'card.due':
        return cardService.update(actor, row.entityId, { dueAt: before === null ? null : String(before) })
      case 'card.labels': {
        // Labels deleted from the board since can't go back on the card.
        const card = db.select({ boardId: cards.boardId }).from(cards).where(eq(cards.id, row.entityId)).get()
        const wanted = Array.isArray(before) ? before : []
        const existing = wanted.length && card ? db.select({ id: labels.id }).from(labels).where(and(eq(labels.boardId, card.boardId), inArray(labels.id, wanted))).all().map((l) => l.id) : []
        return cardService.update(actor, row.entityId, { labelIds: wanted.filter((id) => existing.includes(id)) })
      }
      case 'card.moved': {
        await cardService.move(actor, row.entityId, { columnId: columnOf(before), index: AT_END })
        // Back on the board it came from, the labels it lost on the way go back on, those still there.
        const lost = Array.isArray(row.meta.labelIds) ? row.meta.labelIds : []
        const card = lost.length ? db.select({ boardId: cards.boardId }).from(cards).where(eq(cards.id, row.entityId)).get() : undefined
        if (!card) return
        const back = db.select({ id: labels.id }).from(labels).where(and(eq(labels.boardId, card.boardId), inArray(labels.id, lost))).all().map((l) => l.id)
        const has = db.select({ id: cardLabels.labelId }).from(cardLabels).where(eq(cardLabels.cardId, row.entityId)).all().map((l) => l.id)
        if (back.some((id) => !has.includes(id))) await cardService.update(actor, row.entityId, { labelIds: [...new Set([...has, ...back])] })
        return
      }
      case 'card.archived':
        return cardService.setArchived(actor, row.entityId, before === true)
      case 'card.created':
      case 'card.restored':
        return cardService.remove(actor, row.entityId)
      case 'card.linked':
        return cardService.unlinkPage(actor, row.entityId, subject)
      case 'checklist.created':
      case 'checklist.restored':
        return cardService.removeChecklist(actor, subject)
      case 'checklist.title':
        return cardService.updateChecklist(actor, subject, { title: String(before ?? '') })
      case 'item.created':
      case 'item.restored':
        return cardService.removeItem(actor, subject)
      case 'item.text':
        return cardService.updateItem(actor, subject, { text: String(before ?? '') })
      case 'item.done':
        return cardService.updateItem(actor, subject, { done: before === true })
      case 'attachment.created':
      case 'attachment.restored':
        return attachmentService.remove(actor, subject)
      case 'attachment.moved': {
        const back = before as AttachmentPlace | null
        return attachmentService.move(actor, subject, back?.pageId ? { pageId: back.pageId } : { cardId: back?.cardId ?? '' })
      }
      case 'page.deleted':
      case 'card.deleted':
      case 'card.unlinked':
      case 'checklist.deleted':
      case 'item.deleted':
      case 'attachment.deleted':
        return trashService.restore(actor, trashId)
    }
  }
}
