import {
  type ActorRef,
  MAX_COLUMNS,
  type TrashConflictDTO,
  type TrashContents,
  type TrashKind,
  type TrashNodeDTO,
  type TrashPlace,
  type TrashPlaceKind,
  type TrashPlanDTO,
  type TrashRelationDTO,
  type TrashRestoreInput,
  type TrashTreeDTO,
  commentExcerpt,
} from '@orqevio/shared'
import { type SQL, eq, sql } from 'drizzle-orm'
import type { DbOrTx } from '../db/client'
import { inList } from '../db/in-list'
import * as schema from '../db/schema'
import { AppError, badRequest, notFound } from '../lib/errors'
import { safeFilename } from './attachments'
import type { TableName } from './trash'

/**
 * The trash as a tree. Each row kept in the trash is read lightly (its references and its name,
 * never its long texts), and what is a thing of its own (a project, a board, a card, a page, a
 * file…) becomes a node hanging from what held it: from another node when that is in the trash
 * too, also if it was deleted later, or else from what is still there, or from nothing when that
 * was deleted for good. The rows were always kept one by one, so this needs no migration: what
 * is in the trash from before shows as a tree as it is.
 */

export const SEPARATOR = ' › '

type Entry = typeof schema.trash.$inferSelect
type LiveKind = Exclude<TrashKind, 'link'>

/** A kept row, read lightly. */
export interface IndexRow {
  rowId: number
  trashId: string
  table: TableName
  id: string | null
  name: string | null
  projectId: string | null
  boardId: string | null
  columnId: string | null
  cardId: string | null
  checklistId: string | null
  parentId: string | null
  pageId: string | null
  labelId: string | null
  size: number | null
  source: string | null
  position: string | null
  storageKey: string | null
}

export interface Ref {
  kind: LiveKind
  id: string
}

export interface Node {
  key: string
  kind: TrashKind
  /** The id it had (for a link, `<card id>:<page id>`). */
  id: string
  row: IndexRow
  entry: Entry
  title: string
  /** What held it, by kind and id. Null for a project. */
  ref: Ref | null
  parent: Node | null
  children: Node[]
  place: TrashPlace
  /** The item its entry was made for, not something that went with it. */
  entryRoot: boolean
}

const NODE_KIND: Partial<Record<TableName, LiveKind>> = {
  projects: 'project',
  boards: 'board',
  board_columns: 'column',
  labels: 'label',
  cards: 'card',
  checklists: 'checklist',
  checklist_items: 'checklist_item',
  card_comments: 'comment',
  pages: 'page',
  attachments: 'attachment',
}

const LIVE_TABLE: Record<LiveKind, string> = {
  project: 'projects',
  board: 'boards',
  column: 'board_columns',
  label: 'labels',
  card: 'cards',
  checklist: 'checklists',
  checklist_item: 'checklist_items',
  comment: 'card_comments',
  page: 'pages',
  attachment: 'attachments',
}

/** What is read of something that is there: its name and what holds it. */
const LIVE_COLUMNS: Record<LiveKind, SQL> = {
  project: sql`id, name`,
  board: sql`id, name, project_id`,
  column: sql`id, name, board_id`,
  label: sql`id, name, board_id`,
  card: sql`id, title AS name, column_id, board_id`,
  checklist: sql`id, title AS name, card_id`,
  checklist_item: sql`id, text AS name, checklist_id`,
  comment: sql`id, substr(body, 1, 400) AS name, card_id`,
  page: sql`id, title AS name, project_id, parent_id`,
  attachment: sql`id, filename AS name, card_id, page_id`,
}

/** The order things show in, under what holds them. */
const RANK: Record<TrashKind, number> = { project: 0, board: 1, column: 2, label: 3, card: 4, checklist: 5, checklist_item: 6, comment: 7, page: 8, attachment: 9, link: 10 }

const COUNTED: Partial<Record<TrashKind, keyof TrashContents>> = {
  project: 'projects',
  board: 'boards',
  column: 'columns',
  card: 'cards',
  page: 'pages',
  attachment: 'attachments',
  checklist: 'checklists',
  checklist_item: 'items',
  label: 'labels',
  link: 'links',
  comment: 'comments',
}

/** Where something can be put instead of its own place, by kind. */
export const CHOOSE: Record<TrashKind, TrashPlaceKind[]> = {
  project: [],
  board: ['project'],
  column: ['board'],
  label: ['board'],
  card: ['column'],
  checklist: ['card'],
  checklist_item: ['checklist'],
  comment: ['card'],
  page: ['project', 'page'],
  attachment: ['card', 'page'],
  link: [],
}

/** Kinds whose names are compared with those next to them when they go back. */
const NAMED: ReadonlySet<TrashKind> = new Set(['project', 'board', 'column', 'label', 'card', 'page', 'attachment'])

/** The longest name each kind takes, as when it is made. */
export const NAME_MAX: Partial<Record<TrashKind, number>> = { project: 80, board: 80, column: 60, label: 40, card: 300, page: 200, attachment: 180 }

/** The column holding the name, in each table. */
export const NAME_COLUMN: Partial<Record<TrashKind, string>> = { project: 'name', board: 'name', column: 'name', label: 'name', card: 'title', page: 'title', attachment: 'filename' }

const keyOf = (kind: TrashKind, id: string) => `${kind}:${id}`
const refKey = (ref: Ref) => keyOf(ref.kind, ref.id)
const norm = (name: string) => name.normalize('NFC').trim().toLowerCase()

interface LiveRow {
  id: string
  name: string | null
  project_id?: string | null
  board_id?: string | null
  column_id?: string | null
  card_id?: string | null
  checklist_id?: string | null
  parent_id?: string | null
  page_id?: string | null
}

/** What is there now, looked up once each. */
export class Live {
  private readonly rows = new Map<string, LiveRow | null>()

  constructor(
    private readonly db: DbOrTx,
    readonly workspaceId: string,
  ) {}

  /** Looks up many at once: SQLite in a Durable Object takes at most 100 parameters a query. */
  prefetch(kind: LiveKind, ids: Iterable<string>) {
    const unknown = [...new Set(ids)].filter((id) => !this.rows.has(keyOf(kind, id)))
    for (let i = 0; i < unknown.length; i += 500) {
      const chunk = unknown.slice(i, i + 500)
      const found = this.db.all<LiveRow>(
        sql`SELECT ${LIVE_COLUMNS[kind]} FROM ${sql.identifier(LIVE_TABLE[kind])} WHERE workspace_id = ${this.workspaceId} AND ${inList(sql`id`, chunk)}`,
      )
      const byId = new Map(found.map((row) => [row.id, row]))
      for (const id of chunk) this.rows.set(keyOf(kind, id), byId.get(id) ?? null)
    }
  }

  get(kind: LiveKind, id: string | null | undefined): LiveRow | null {
    if (!id) return null
    const key = keyOf(kind, id)
    if (!this.rows.has(key)) this.prefetch(kind, [id])
    return this.rows.get(key) ?? null
  }

  exists(kind: LiveKind, id: string | null | undefined) {
    return this.get(kind, id) !== null
  }

  /** The names from the top down to it, its own included: "Project › Board › Column". */
  path(ref: Ref | null, depth = 0): string[] {
    if (!ref || depth > 64) return []
    const row = this.get(ref.kind, ref.id)
    if (!row) return []
    const name = row.name ?? ''
    const up = (kind: LiveKind, id: string | null | undefined) => (id ? this.path({ kind, id }, depth + 1) : [])
    switch (ref.kind) {
      case 'project':
        return [name]
      case 'board':
        return [...up('project', row.project_id), name]
      case 'column':
      case 'label':
      case 'card':
        return [...up('board', row.board_id), name]
      case 'checklist':
        return [...up('card', row.card_id), name]
      case 'checklist_item':
        return [...up('checklist', row.checklist_id), name]
      case 'comment':
        return [...up('card', row.card_id), commentExcerpt(name)]
      case 'page':
        return [...(row.parent_id ? up('page', row.parent_id) : up('project', row.project_id)), name]
      case 'attachment':
        return [...(row.card_id ? up('card', row.card_id) : up('page', row.page_id)), name]
    }
  }

  /** How many columns a board has now. */
  columnCount(boardId: string) {
    return this.db.get<{ total: number }>(sql`SELECT count(*) AS total FROM board_columns WHERE board_id = ${boardId}`)?.total ?? 0
  }

  /** The names of what is next to where something of `kind` goes, in `container`. */
  siblingNames(kind: TrashKind, container: Ref | null): string[] {
    const names = (query: SQL) => this.db.all<{ name: string }>(query).map((r) => r.name)
    const ws = this.workspaceId
    switch (kind) {
      case 'project':
        return names(sql`SELECT name FROM projects WHERE workspace_id = ${ws}`)
      case 'board':
        return container ? names(sql`SELECT name FROM boards WHERE project_id = ${container.id}`) : []
      case 'column':
        return container ? names(sql`SELECT name FROM board_columns WHERE board_id = ${container.id}`) : []
      case 'label':
        return container ? names(sql`SELECT name FROM labels WHERE board_id = ${container.id}`) : []
      case 'card':
        return container ? names(sql`SELECT title AS name FROM cards WHERE column_id = ${container.id} AND archived_at IS NULL`) : []
      case 'page':
        if (!container) return []
        return container.kind === 'page'
          ? names(sql`SELECT title AS name FROM pages WHERE parent_id = ${container.id}`)
          : names(sql`SELECT title AS name FROM pages WHERE project_id = ${container.id} AND parent_id IS NULL`)
      case 'attachment':
        if (!container) return []
        return container.kind === 'card'
          ? names(sql`SELECT filename AS name FROM attachments WHERE card_id = ${container.id}`)
          : names(sql`SELECT filename AS name FROM attachments WHERE page_id = ${container.id}`)
      default:
        return []
    }
  }
}

function parentRef(kind: TrashKind, row: IndexRow): Ref | null {
  const ref = (k: LiveKind, id: string | null): Ref | null => (id ? { kind: k, id } : null)
  switch (kind) {
    case 'project':
      return null
    case 'board':
      return ref('project', row.projectId)
    case 'column':
    case 'label':
      return ref('board', row.boardId)
    case 'card':
      return ref('column', row.columnId)
    case 'checklist':
      return ref('card', row.cardId)
    case 'checklist_item':
      return ref('checklist', row.checklistId)
    case 'comment':
      return ref('card', row.cardId)
    case 'page':
      return row.parentId ? ref('page', row.parentId) : ref('project', row.projectId)
    case 'attachment':
      return row.cardId ? ref('card', row.cardId) : ref('page', row.pageId)
    case 'link':
      return ref('card', row.cardId)
  }
}

/** Positions are fractional keys, ordered by byte value. */
const byPosition = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1)
/** In the order they were in: by kind, then where each was among the others. */
const byOrder = (a: Node, b: Node) =>
  RANK[a.kind] - RANK[b.kind] || byPosition(a.row.position, b.row.position) || a.title.localeCompare(b.title) || a.entry.deletedAt.getTime() - b.entry.deletedAt.getTime() || a.row.rowId - b.row.rowId

/** Everything in a workspace's trash, as a tree. */
export class TrashIndex {
  readonly nodes = new Map<string, Node>()
  /** Rows joining two things (a card's label, a card and a page) that are not things of their own. */
  readonly relations: IndexRow[] = []
  /** Links made by a page mentioning a card: never put back, they are rebuilt from what pages say. */
  readonly mentions: IndexRow[] = []
  readonly entries = new Map<string, Entry>()
  readonly live: Live

  private constructor(db: DbOrTx, workspaceId: string) {
    this.live = new Live(db, workspaceId)
  }

  static load(db: DbOrTx, workspaceId: string) {
    const index = new TrashIndex(db, workspaceId)
    for (const entry of db.select().from(schema.trash).where(eq(schema.trash.workspaceId, workspaceId)).all()) index.entries.set(entry.id, entry)
    const rows = db.all<Omit<IndexRow, 'table'> & { tableName: TableName }>(sql`
      SELECT r.id AS rowId, r.trash_id AS trashId, r.table_name AS tableName,
        json_extract(r.data, '$.id') AS id,
        coalesce(json_extract(r.data, '$.name'), json_extract(r.data, '$.title'), json_extract(r.data, '$.filename'), json_extract(r.data, '$.text'), substr(json_extract(r.data, '$.body'), 1, 400)) AS name,
        json_extract(r.data, '$.project_id') AS projectId,
        json_extract(r.data, '$.board_id') AS boardId,
        json_extract(r.data, '$.column_id') AS columnId,
        json_extract(r.data, '$.card_id') AS cardId,
        json_extract(r.data, '$.checklist_id') AS checklistId,
        json_extract(r.data, '$.parent_id') AS parentId,
        json_extract(r.data, '$.page_id') AS pageId,
        json_extract(r.data, '$.label_id') AS labelId,
        json_extract(r.data, '$.size') AS size,
        json_extract(r.data, '$.source') AS source,
        -- Comments have no place of their own: they go in the order they were written (and, within
        -- a millisecond, in the order they were kept, which is that of their rows).
        coalesce(json_extract(r.data, '$.position'), CASE WHEN r.table_name = 'card_comments' THEN printf('%015d%012d', json_extract(r.data, '$.created_at'), r.id) END) AS position,
        r.storage_key AS storageKey
      FROM trash_rows r JOIN trash t ON t.id = r.trash_id
      WHERE t.workspace_id = ${workspaceId}
      ORDER BY r.id`)
    for (const { tableName, ...rest } of rows) {
      const row: IndexRow = { ...rest, table: tableName }
      const entry = index.entries.get(row.trashId)
      if (!entry) continue
      const kind = NODE_KIND[row.table]
      if (kind && row.id) {
        index.add(kind, row.id, row, entry)
      } else if (row.table === 'card_page_links') {
        if (row.source === 'mention') index.mentions.push(row)
        else if (entry.kind === 'link' && entry.entityId === `${row.cardId}:${row.pageId}`) index.add('link', `${row.cardId}:${row.pageId}`, row, entry)
        else index.relations.push(row)
      } else if (row.table === 'card_labels') {
        index.relations.push(row)
      }
    }
    index.resolve()
    return index
  }

  private add(kind: TrashKind, id: string, row: IndexRow, entry: Entry) {
    const key = kind === 'link' ? `link:${id}` : keyOf(kind, id)
    // An id is in the trash once; should it be twice, the latest deletion holds it.
    this.nodes.set(key, {
      key,
      kind,
      id,
      row,
      entry,
      // A comment shows as a line of its text, without the Markdown.
      title: kind === 'comment' ? commentExcerpt(row.name ?? '') : (row.name ?? ''),
      ref: parentRef(kind, row),
      parent: null,
      children: [],
      place: 'original',
      entryRoot: entry.kind === kind && entry.entityId === id,
    })
  }

  /** Hangs each node from what held it, and says where the rest goes back. */
  private resolve() {
    const missing = new Map<LiveKind, Set<string>>()
    for (const node of this.nodes.values()) {
      if (!node.ref) continue
      const parent = this.nodes.get(refKey(node.ref))
      if (parent && parent !== node) {
        node.parent = parent
        parent.children.push(node)
        node.place = 'trash'
      } else {
        const ids = missing.get(node.ref.kind) ?? new Set<string>()
        ids.add(node.ref.id)
        missing.set(node.ref.kind, ids)
      }
    }
    for (const [kind, ids] of missing) this.live.prefetch(kind, ids)
    // A link's page: its title, and whether it is there.
    this.live.prefetch('page', [...this.nodes.values()].filter((n) => n.kind === 'link' && !this.nodes.has(keyOf('page', n.row.pageId ?? ''))).map((n) => n.row.pageId ?? ''))
    for (const node of this.nodes.values()) {
      if (node.ref && !node.parent) node.place = this.live.exists(node.ref.kind, node.ref.id) ? 'original' : 'gone'
      if (node.kind === 'link') node.title = this.nodes.get(keyOf('page', node.row.pageId ?? ''))?.title ?? this.live.get('page', node.row.pageId)?.name ?? ''
      node.children.sort(byOrder)
    }
    // A loop can't happen (an id is held by one thing), but a broken one must not hang a walk.
    for (const node of this.nodes.values()) {
      const seen = new Set<Node>()
      for (let up = node.parent; up; up = up.parent) {
        if (seen.has(up) || up === node) {
          node.parent?.children.splice(node.parent.children.indexOf(node), 1)
          node.parent = null
          node.place = 'gone'
          break
        }
        seen.add(up)
      }
    }
  }

  node(key: string) {
    return this.nodes.get(key)
  }

  /** What is at the top: what is not held by anything else in the trash. Newest first. */
  top() {
    return [...this.nodes.values()].filter((n) => !n.parent).sort((a, b) => b.entry.deletedAt.getTime() - a.entry.deletedAt.getTime() || b.row.rowId - a.row.rowId)
  }

  /** The node and everything below it, each before what it holds. */
  subtree(node: Node): Node[] {
    const out: Node[] = []
    const walk = (n: Node) => {
      out.push(n)
      for (const child of n.children) walk(child)
    }
    walk(node)
    return out
  }

  /** What holds it in the trash, top first. */
  ancestors(node: Node): Node[] {
    const out: Node[] = []
    for (let up = node.parent; up; up = up.parent) out.unshift(up)
    return out
  }

  /** Of `nodes`, those not below another one of them: what is below one comes with it. */
  outermost(nodes: Node[]) {
    const picked = new Set(nodes)
    return [...picked].filter((node) => !this.ancestors(node).some((up) => picked.has(up)))
  }

  /**
   * What deleting `nodes` for good takes: everything below them, and the links to a page that goes
   * (with what is below them), wherever those wait in the trash.
   */
  goneWith(nodes: Node[]) {
    const gone = new Map<string, Node>()
    for (const node of nodes) for (const n of this.subtree(node)) gone.set(n.key, n)
    for (const n of this.nodes.values()) if (n.kind === 'link' && gone.has(`page:${n.row.pageId}`)) for (const m of this.subtree(n)) gone.set(m.key, m)
    return gone
  }

  /** Everything deleting `nodes` for good takes (see goneWith), by kind, and the size of its files. */
  totals(nodes: Node[]): { contents: TrashContents; bytes: number } {
    const all = this.goneWith(nodes)
    const contents: TrashContents = {}
    let bytes = 0
    for (const n of all.values()) {
      if (n.kind === 'attachment') bytes += Number(n.row.size ?? 0)
      const counted = COUNTED[n.kind]
      if (counted) contents[counted] = (contents[counted] ?? 0) + 1
    }
    return { contents, bytes }
  }

  /** Whether `node` is `top` or below it. */
  within(node: Node, top: Node) {
    for (let n: Node | null = node; n; n = n.parent) if (n === top) return true
    return false
  }

  /** Where it goes back, for people: "Project › Board" when that is there; where it was when that is gone. */
  location(node: Node) {
    if (node.parent) return ''
    if (node.place === 'gone') return node.entryRoot ? node.entry.location : ''
    return this.live.path(node.ref).join(SEPARATOR)
  }

  dto(node: Node): TrashNodeDTO {
    const contents: TrashContents = {}
    const earlierContents: TrashContents = {}
    let bytes = 0
    for (const n of this.subtree(node)) {
      if (n.kind === 'attachment') bytes += Number(n.row.size ?? 0)
      if (n === node) continue
      const counted = COUNTED[n.kind]
      if (!counted) continue
      contents[counted] = (contents[counted] ?? 0) + 1
      if (isEarlier(n)) earlierContents[counted] = (earlierContents[counted] ?? 0) + 1
    }
    const entry = node.entry
    return {
      key: node.key,
      kind: node.kind,
      entityId: node.id,
      title: node.title,
      parentKey: node.parent?.key ?? null,
      trashId: entry.id,
      place: node.place,
      location: this.location(node),
      earlier: isEarlier(node),
      contents,
      earlierContents,
      bytes,
      deletedBy: actorOf(entry),
      deletedAt: entry.deletedAt.toISOString(),
      expiresAt: entry.expiresAt.toISOString(),
    }
  }

  tree(node: Node): TrashTreeDTO {
    return { node: this.dto(node), below: this.subtree(node).slice(1).map((n) => this.dto(n)), ancestors: this.ancestors(node).map((n) => ({ key: n.key, kind: n.kind, title: n.title, trashId: n.entry.id })) }
  }
}

/** Deleted on its own before what holds it in the trash. */
export const isEarlier = (node: Node) => node.parent !== null && node.parent.entry.id !== node.entry.id

export const actorOf = (entry: Entry): ActorRef => ({
  kind: entry.actorKind,
  id: (entry.actorKind === 'agent' ? entry.actorTokenId : entry.actorUserId) ?? '',
  name: entry.actorName,
})

// ── Planning a restore ───────────────────────────────────────────

/** A container made anew because the original was deleted for good (only in what was in the trash before 1.3.0). */
export interface Created {
  kind: 'project' | 'page' | 'column'
  id: string
  title: string
  /** Where it is made: a page in a project, a column in a board. */
  in: Ref | null
}

export interface Placement {
  /** What it goes into. */
  container: Ref
  /** Not where it was: it goes at the end of what it goes into. */
  moved: boolean
  /** The references it is put back with. */
  sets: Record<string, string | null>
}

export interface Plan {
  root: Node
  to: 'original' | 'recreate' | 'other' | null
  subtree: Node[]
  excluded: Set<string>
  /** What holds it in the trash and comes back with it to hold it, top first. */
  path: Node[]
  create: Created[]
  /** What "recreate" would bring back and make, whatever is asked. */
  recreatePath: Node[]
  recreateCreate: Created[]
  /** Other ends of its relations that come back too, with what is below them. */
  extras: Node[]
  /** Everything that comes back, each after what holds it. */
  coming: Node[]
  comingKeys: Set<string>
  placement: Map<string, Placement>
  /** New names, by node key. */
  names: Map<string, string>
  conflicts: TrashConflictDTO[]
  /** Relation rows: put back, moved to wait with their other end, or dropped. */
  reinsert: IndexRow[]
  wait: { row: IndexRow; trashId: string }[]
  drop: IndexRow[]
  /** Mention links of what comes back: rebuilt from what pages say, never put back. */
  mentions: IndexRow[]
  relations: TrashRelationDTO[]
  canRecreate: boolean
  choose: TrashPlaceKind[]
  location: string
  /** Boards that would hold more columns than they take. */
  limits: { board: string; count: number; max: number }[]
  missing: ('place' | 'names' | 'columns')[]
}

export const restoreError = (code: 'restore_place_in_trash' | 'restore_place_gone' | 'restore_changed', message: string, details?: unknown) => new AppError(409, code, message, details)

/** Takes away from `location` the path of what is still there: what remains is the name of what is gone. */
function remainder(location: string, prefix: string[]) {
  const start = prefix.join(SEPARATOR)
  if (start && location.startsWith(start + SEPARATOR)) return location.slice(start.length + SEPARATOR.length)
  return location.split(SEPARATOR).at(-1) ?? location
}

/**
 * What can be made anew to hold `node`, whose place was deleted for good. Only the level right
 * above it, and only where what holds that is known and there: a project for a board or a top
 * page, a parent page in its project, a column in its board. Names come from where it was.
 */
function creatable(index: TrashIndex, node: Node): Created[] | null {
  if (!node.entryRoot) return null
  const live = index.live
  const location = node.entry.location
  const made = (kind: Created['kind'], title: string, where: Ref | null): Created[] => [{ kind, id: crypto.randomUUID(), title: title.trim() || 'Restored', in: where }]
  switch (node.kind) {
    case 'board':
      return made('project', location, null)
    case 'page':
      if (!node.row.parentId) return made('project', location, null)
      if (!live.exists('project', node.row.projectId)) return null
      return made('page', remainder(location, live.path({ kind: 'project', id: node.row.projectId! })), { kind: 'project', id: node.row.projectId! })
    case 'card':
      if (!live.exists('board', node.row.boardId)) return null
      return made('column', remainder(location, live.path({ kind: 'board', id: node.row.boardId! })), { kind: 'board', id: node.row.boardId! })
    default:
      return null
  }
}

/**
 * Works out what restoring `input.key` as asked does, without changing anything: what comes
 * back, where, with which names, and what becomes of its relations. Restoring runs it again,
 * inside the transaction that applies it.
 */
export function planRestore(index: TrashIndex, input: TrashRestoreInput): Plan {
  const root = index.node(input.key)
  if (!root) throw notFound('Trash item')
  const live = index.live
  const subtree = index.subtree(root)

  // What is left out stays in the trash, with everything below it.
  const asked = new Set(input.exclude)
  asked.delete(root.key)
  const excluded = new Set<string>()
  for (const n of subtree) if (asked.has(n.key) || (n.parent && excluded.has(n.parent.key))) excluded.add(n.key)
  const included = subtree.filter((n) => !excluded.has(n.key))

  // Where it goes.
  let choose = CHOOSE[root.kind]
  let path: Node[] = []
  let create: Created[] = []
  let canRecreate = false
  if (root.place === 'trash') {
    path = index.ancestors(root)
    const top = path[0]!
    const made = top.place === 'gone' ? creatable(index, top) : []
    if (made) {
      create = made
      canRecreate = true
    }
  } else if (root.place === 'gone') {
    const made = creatable(index, root)
    if (made) {
      create = made
      canRecreate = true
    }
  }
  // A link needs its page: when that is deleted for good, it can't come back anywhere.
  const linkPageGone = root.kind === 'link' && !index.node(keyOf('page', root.row.pageId ?? '')) && !live.exists('page', root.row.pageId)
  if (linkPageGone) {
    choose = []
    canRecreate = false
  }

  let to: Plan['to'] = input.to?.kind ?? (root.place === 'original' ? 'original' : canRecreate ? 'recreate' : null)
  if (linkPageGone || (to === 'original' && root.place !== 'original')) to = null
  if (to === 'recreate' && root.place === 'original') to = 'original'
  if (to === 'recreate' && !canRecreate) to = null
  let other: Ref | null = null
  if (to === 'other' && input.to?.kind === 'other') {
    const chosen = input.to.parent
    if (!choose.includes(chosen.kind) || !live.exists(chosen.kind, chosen.id)) throw restoreError('restore_place_gone', 'The place chosen to put it in is not there.')
    other = chosen
  }
  // What recreating would bring back or make, said even when something else is asked.
  const recreatePath = path
  const recreateCreate = create
  if (to !== 'recreate') {
    path = []
    create = []
  }

  const comingKeys = new Set<string>()
  const coming: Node[] = []
  const add = (n: Node) => {
    if (comingKeys.has(n.key)) return
    comingKeys.add(n.key)
    coming.push(n)
  }
  for (const n of path) add(n)
  for (const n of included) add(n)

  // The other ends of relations that can come back too: in the trash, not below what is
  // restored (those follow its boxes), and with their own place there by then.
  const canInclude = (n: Node) => !comingKeys.has(n.key) && !index.within(n, root) && (n.place === 'original' || (n.parent !== null && comingKeys.has(n.parent.key)))
  const relationRows = (keys: Set<string>) => {
    const linkNodes = [...keys].map((k) => index.node(k)!).filter((n) => n.kind === 'link')
    return [
      ...index.relations.filter((r) => keys.has(keyOf('card', r.cardId ?? '')) || keys.has(r.table === 'card_labels' ? keyOf('label', r.labelId ?? '') : keyOf('page', r.pageId ?? ''))),
      ...linkNodes.map((n) => n.row),
    ]
  }
  const otherEnds = new Map<string, Node>()
  for (const r of relationRows(comingKeys)) {
    for (const key of [keyOf('card', r.cardId ?? ''), r.table === 'card_labels' ? keyOf('label', r.labelId ?? '') : keyOf('page', r.pageId ?? '')]) {
      const n = index.node(key)
      if (n && canInclude(n)) otherEnds.set(key, n)
    }
  }
  // What comes back from the rest of the trash besides. One that no longer applies (what had it
  // was left out meanwhile) is left out of a plan, and refused when restoring: it was shown.
  const extraRoots: Node[] = []
  for (const key of new Set(input.include)) {
    const n = otherEnds.get(key)
    if (n) extraRoots.push(n)
    else if (!input.dryRun) throw restoreError('restore_changed', 'Something in the trash changed meanwhile: look again before restoring.')
  }
  /** What comes back by itself, not as the other end of a relation. */
  const own = new Set(comingKeys)
  const extras: Node[] = []
  for (const n of extraRoots) for (const below of index.subtree(n)) if (!comingKeys.has(below.key)) extras.push(below)
  for (const n of extras) add(n)

  // Where each thing goes, and the references it goes back with.
  const createdById = new Map(create.map((c) => [c.id, c]))
  const lastMade = create.at(-1)
  const madeRef = (c: Created): Ref => ({ kind: c.kind, id: c.id })
  const finalBoard = new Map<string, string | null>()
  const finalProject = new Map<string, string | null>()
  const boardOfColumn = (id: string) => {
    const made = createdById.get(id)
    if (made) return made.in?.id ?? null
    return finalBoard.has(keyOf('column', id)) ? finalBoard.get(keyOf('column', id))! : (live.get('column', id)?.board_id ?? null)
  }
  const projectOfPage = (id: string) => {
    const made = createdById.get(id)
    if (made) return made.in?.id ?? null
    return finalProject.has(keyOf('page', id)) ? finalProject.get(keyOf('page', id))! : (live.get('page', id)?.project_id ?? null)
  }
  const placement = new Map<string, Placement>()
  for (const n of coming) {
    if (!n.ref) continue
    let container: Ref = n.ref
    let moved = false
    if (lastMade && (n === path[0] || (n === root && root.place === 'gone'))) {
      container = madeRef(lastMade)
      moved = true
    }
    if (n === root && other) {
      container = other
      moved = true
    }
    const sets: Record<string, string | null> = {}
    switch (n.kind) {
      case 'board':
        sets.project_id = container.id
        finalProject.set(n.key, container.id)
        break
      case 'column':
      case 'label':
        sets.board_id = container.id
        finalBoard.set(n.key, container.id)
        break
      case 'card': {
        // A card goes on the board of its column, wherever that is now.
        const board = boardOfColumn(container.id)
        sets.column_id = container.id
        sets.board_id = board
        finalBoard.set(n.key, board)
        break
      }
      case 'checklist':
      case 'comment':
        sets.card_id = container.id
        break
      case 'checklist_item':
        sets.checklist_id = container.id
        break
      case 'page': {
        const project = container.kind === 'page' ? projectOfPage(container.id) : container.id
        sets.parent_id = container.kind === 'page' ? container.id : null
        sets.project_id = project
        finalProject.set(n.key, project)
        break
      }
      case 'attachment':
        sets.card_id = container.kind === 'card' ? container.id : null
        sets.page_id = container.kind === 'page' ? container.id : null
        break
    }
    placement.set(n.key, { container, moved, sets })
  }

  // Relations: put back, waiting with their other end in the trash, or lost.
  const state = (kind: LiveKind, id: string | null): 'coming' | 'trash' | 'live' | 'gone' => {
    if (!id) return 'gone'
    const key = keyOf(kind, id)
    if (comingKeys.has(key)) return 'coming'
    if (index.node(key)) return 'trash'
    return live.exists(kind, id) ? 'live' : 'gone'
  }
  const rows = relationRows(comingKeys)
  live.prefetch('card', rows.map((r) => r.cardId ?? ''))
  live.prefetch('label', rows.filter((r) => r.table === 'card_labels').map((r) => r.labelId ?? ''))
  live.prefetch('page', rows.filter((r) => r.table === 'card_page_links').map((r) => r.pageId ?? ''))
  const boardOfCard = (id: string) => (finalBoard.has(keyOf('card', id)) ? finalBoard.get(keyOf('card', id)) : (live.get('card', id)?.board_id ?? null))
  const boardOfLabel = (id: string) => (finalBoard.has(keyOf('label', id)) ? finalBoard.get(keyOf('label', id)) : (live.get('label', id)?.board_id ?? null))
  const titleOf = (kind: LiveKind, id: string) => index.node(keyOf(kind, id))?.title ?? live.get(kind, id)?.name ?? ''
  const extraKeys = new Set(extraRoots.map((n) => n.key))
  const reinsert: IndexRow[] = []
  const wait: Plan['wait'] = []
  const drop: IndexRow[] = []
  const groups = new Map<string, TrashRelationDTO>()
  const note = (group: Omit<TrashRelationDTO, 'count' | 'first'>, first: string) => {
    const id = `${group.state}|${group.kind}|${group.key ?? group.title}`
    const found = groups.get(id)
    if (found) found.count++
    else groups.set(id, { ...group, count: 1, first })
  }
  for (const r of rows) {
    const cardId = r.cardId ?? ''
    const isLabel = r.table === 'card_labels'
    const otherKind: LiveKind = isLabel ? 'label' : 'page'
    const otherId = (isLabel ? r.labelId : r.pageId) ?? ''
    const ends = [
      { kind: 'card' as LiveKind, id: cardId, state: state('card', cardId) },
      { kind: otherKind, id: otherId, state: state(otherKind, otherId) },
    ]
    const isLinkNode = r.table === 'card_page_links' && index.node(`link:${cardId}:${otherId}`)?.row === r
    // A link coming back is the card's: its page is the other end. Otherwise the near end is what
    // comes back as asked, so that the other end, brought along, is still shown as such.
    const near = isLinkNode ? ends[0] : (ends.find((e) => own.has(keyOf(e.kind, e.id))) ?? ends.find((e) => e.state === 'coming'))
    if (!near) continue
    const far = ends.find((e) => e !== near)!
    const shown = extraKeys.has(keyOf(far.kind, far.id))
    if (shown) note({ kind: far.kind as TrashRelationDTO['kind'], title: titleOf(far.kind, far.id), key: keyOf(far.kind, far.id), state: 'trash', included: true, canInclude: true }, titleOf(near.kind, near.id))
    if (far.state === 'coming' || far.state === 'live') {
      if (isLabel && boardOfCard(cardId) !== boardOfLabel(otherId)) {
        // Labels belong to a board: one of another board than the card's now does not apply.
        drop.push(r)
        note({ kind: 'label', title: titleOf('label', otherId), key: index.node(keyOf('label', otherId)) ? keyOf('label', otherId) : null, state: 'other_board', included: false, canInclude: false }, titleOf('card', cardId))
      } else if (!isLinkNode) {
        reinsert.push(r)
      }
    } else if (far.state === 'trash') {
      // It waits for the other end, with it in the trash, and comes back when that does.
      const holder = index.node(keyOf(far.kind, far.id))!
      if (r.trashId !== holder.entry.id) wait.push({ row: r, trashId: holder.entry.id })
      note({ kind: far.kind as TrashRelationDTO['kind'], title: holder.title, key: holder.key, state: 'trash', included: false, canInclude: canInclude(holder) }, titleOf(near.kind, near.id))
    } else {
      drop.push(r)
      note({ kind: far.kind as TrashRelationDTO['kind'], title: '', key: null, state: 'gone', included: false, canInclude: false }, titleOf(near.kind, near.id))
    }
  }
  // A link waiting for its page, or lost with it, does not go back now.
  const waitingLinks = new Set([...wait.map((w) => w.row), ...drop].filter((r) => r.table === 'card_page_links').map((r) => `link:${r.cardId}:${r.pageId}`))

  // Names already used where things go back: decided by the person, or kept on purpose.
  const names = new Map<string, string>()
  for (const [key, value] of Object.entries(input.names)) {
    const n = index.node(key)
    if (!n || !comingKeys.has(key) || !NAMED.has(n.kind)) continue
    const max = NAME_MAX[n.kind] ?? 300
    if (value.length > max) throw badRequest(`A ${n.kind} name has at most ${max} characters`)
    // A file's name is compared as it will be stored.
    const stored = n.kind === 'attachment' ? safeFilename(value) : value
    if (stored !== n.title) names.set(key, stored)
  }
  const keep = new Set(input.keepNames)
  const conflicts: TrashConflictDTO[] = []
  const madeIds = new Set(create.map((c) => c.id))
  const containerName = (ref: Ref | null) => {
    if (!ref) return ''
    const made = createdById.get(ref.id)
    if (made) return made.title
    const node = comingKeys.has(refKey(ref)) ? index.node(refKey(ref)) : undefined
    if (node) return names.get(node.key) ?? node.title
    return live.get(ref.kind, ref.id)?.name ?? ''
  }
  const byContainer = new Map<string, { kind: TrashKind; container: Ref | null; nodes: Node[] }>()
  for (const n of coming) {
    if (!NAMED.has(n.kind)) continue
    const container = n.kind === 'project' ? null : (placement.get(n.key)?.container ?? null)
    const id = `${n.kind}@${container ? refKey(container) : 'workspace'}`
    const group = byContainer.get(id) ?? { kind: n.kind, container, nodes: [] }
    group.nodes.push(n)
    byContainer.set(id, group)
  }
  for (const { kind, container, nodes } of byContainer.values()) {
    const isLive = container === null || (!comingKeys.has(refKey(container)) && !madeIds.has(container.id))
    const taken = new Set((isLive ? live.siblingNames(kind, container) : []).map(norm).filter(Boolean))
    // What was deleted last was there last: something deleted before it is what repeats a name.
    const batches = new Map<string, Node[]>()
    for (const n of nodes) batches.set(n.entry.id, [...(batches.get(n.entry.id) ?? []), n])
    const order = [...batches.values()].sort((a, b) => b[0]!.entry.deletedAt.getTime() - a[0]!.entry.deletedAt.getTime() || (a[0]!.entry.id < b[0]!.entry.id ? -1 : 1))
    for (const batch of order) {
      for (const n of batch) {
        const renamed = names.get(n.key)
        const originalTaken = Boolean(norm(n.title)) && taken.has(norm(n.title))
        if (!originalTaken && renamed === undefined) continue
        const name = renamed ?? n.title
        conflicts.push({ key: n.key, kind: n.kind, original: n.title, name, where: containerName(container), taken: Boolean(norm(name)) && taken.has(norm(name)), kept: keep.has(n.key) })
      }
      for (const n of batch) {
        const name = norm(names.get(n.key) ?? n.title)
        if (name) taken.add(name)
      }
    }
  }

  // Where it ends up, for people.
  let location = ''
  if (to === 'original') location = live.path(root.ref).join(SEPARATOR)
  else if (to === 'other') location = live.path(other).join(SEPARATOR)
  else if (to === 'recreate') {
    const base = create.length ? [...live.path(create[0]!.in), ...create.map((c) => c.title)] : live.path(path[0]?.ref ?? null)
    location = [...base, ...path.map((n) => names.get(n.key) ?? n.title)].join(SEPARATOR)
  }

  // A board holds up to MAX_COLUMNS columns: what comes back can't take one over that, where
  // it goes back or where it is put.
  const columnsInto = new Map<string, number>()
  const into = (boardId: string | null | undefined) => {
    if (boardId) columnsInto.set(boardId, (columnsInto.get(boardId) ?? 0) + 1)
  }
  for (const n of coming) if (n.kind === 'column') into(placement.get(n.key)?.sets.board_id)
  for (const c of create) if (c.kind === 'column') into(c.in?.id)
  const limits: Plan['limits'] = []
  for (const [boardId, incoming] of columnsInto) {
    const key = keyOf('board', boardId)
    const there = comingKeys.has(key) ? 0 : live.columnCount(boardId)
    if (there + incoming <= MAX_COLUMNS) continue
    const board = comingKeys.has(key) ? (names.get(key) ?? index.node(key)?.title ?? '') : (live.get('board', boardId)?.name ?? '')
    limits.push({ board, count: there + incoming, max: MAX_COLUMNS })
  }

  const missing: Plan['missing'] = []
  if (to === null) missing.push('place')
  if (limits.length) missing.push('columns')
  if (conflicts.some((c) => c.taken && !c.kept)) missing.push('names')
  return {
    root,
    to,
    subtree,
    excluded,
    path,
    create,
    recreatePath,
    recreateCreate,
    extras,
    coming: coming.filter((n) => !waitingLinks.has(n.key)),
    comingKeys,
    placement,
    names,
    conflicts,
    reinsert,
    wait,
    drop,
    mentions: index.mentions.filter((r) => comingKeys.has(keyOf('card', r.cardId ?? '')) || comingKeys.has(keyOf('page', r.pageId ?? ''))),
    relations: [...groups.values()],
    canRecreate,
    choose,
    location,
    limits,
    missing,
  }
}

export function planDTO(index: TrashIndex, plan: Plan): TrashPlanDTO {
  const { root } = plan
  return {
    node: index.dto(root),
    nodes: plan.subtree.map((n) => ({
      key: n.key,
      parentKey: n === root ? null : (n.parent?.key ?? null),
      kind: n.kind,
      title: n.title,
      earlier: n !== root && isEarlier(n),
      included: !plan.excluded.has(n.key),
    })),
    where: {
      place: root.place,
      to: plan.to,
      path: plan.recreatePath.map((n) => ({ key: n.key, kind: n.kind, title: plan.names.get(n.key) ?? n.title })),
      create: plan.recreateCreate.map((c) => ({ kind: c.kind, title: c.title })),
      canRecreate: plan.canRecreate,
      choose: plan.choose,
      location: plan.location,
    },
    conflicts: plan.conflicts,
    relations: plan.relations,
    limits: plan.limits,
    ready: plan.missing.length === 0,
    missing: plan.missing,
  }
}
