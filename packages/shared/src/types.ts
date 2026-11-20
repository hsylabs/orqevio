import type { Locale } from './locales'
import type { PaletteColor } from './colors'
import type { KdfParams } from './schemas'
import type { Scope } from './scopes'

/** Response DTOs. Dates are ISO 8601 strings. */

export type Theme = 'system' | 'light' | 'dark'

export interface ActorRef {
  kind: 'user' | 'agent'
  id: string
  name: string
}

export interface UserDTO {
  id: string
  name: string
  theme: Theme
  /** The language the app shows to this user, and in which it names what it creates for them. */
  locale: Locale
  createdAt: string
}

export interface WorkspaceDTO {
  id: string
  name: string
  role: 'owner' | 'editor'
  createdAt: string
}

/** How this copy was installed, which decides how it is updated. */
export const INSTALL_KINDS = ['cli', 'button', 'docker', 'source', 'cloudflare'] as const
export type InstallKind = (typeof INSTALL_KINDS)[number]

/** ORQEVIO_INSTALL as set by each installation path, or `fallback` when missing or unknown. */
export const installKind = (value: string | undefined, fallback: InstallKind): InstallKind =>
  (INSTALL_KINDS as readonly string[]).includes(value ?? '') ? (value as InstallKind) : fallback

export interface UpdateStatusDTO {
  current: string
  /** Latest published version, or null when unknown (check disabled, offline, not published yet). */
  latest: string | null
  updateAvailable: boolean
  install: InstallKind
  /** Worker name of a Cloudflare copy installed with the command, for the update command. */
  copyName: string | null
  /** Notes of the latest version. */
  releaseUrl: string | null
}

export interface MeDTO {
  user: UserDTO
  workspaces: WorkspaceDTO[]
  /** Limits of this copy, so the app can refuse what the server would reject. */
  limits: { maxUploadBytes: number }
}

/** Whether this copy has an owner yet, and whether a new setup code allows recovering access. */
export interface AccessStateDTO {
  claimed: boolean
  recoverable: boolean
  /** How the copy was installed and its Worker name, so the sign-in page gives the right recovery steps. */
  install: InstallKind
  copyName: string | null
  /** Set once the copy was uninstalled from Settings: what is left to remove, and how. */
  uninstalled?: UninstalledDTO
}

export interface UninstalledDTO {
  at: string
  install: InstallKind
  /** Worker name of a Cloudflare copy, for the commands that remove it. */
  copyName: string | null
  /** Its R2 bucket; null when it is the default, `<copyName>-uploads`. */
  bucket: string | null
  /** Where its backups are (see BackupsDTO.where) and whether they were kept or deleted; null when it made none. */
  backups: { kept: boolean; where: BackupPlaceDTO } | null
}

// ── Backups ──────────────────────────────────────────────────────
/** A folder of the server (Docker, Node) or the copy's second R2 bucket (Cloudflare). */
export interface BackupPlaceDTO {
  kind: 'folder' | 'bucket'
  name: string
}

/** Made by itself once a day, asked for in Settings, or made right before restoring another one. */
export type BackupKind = 'daily' | 'manual' | 'before-restore'

export interface BackupDTO {
  id: string
  kind: BackupKind
  createdAt: string
  /** The version of Orqevio that made it. */
  version: string
  /** Its data, compressed, plus the attachments it lists (each kept once for all backups). */
  bytes: number
  counts: { workspaces: number; projects: number; boards: number; cards: number; pages: number; attachments: number; vaultItems: number; trash: number }
  files: number
  /** Attachments that couldn't be copied into it. */
  missingFiles: number
  /** Made by a newer version of Orqevio than this copy runs: update first to restore it. */
  newer: boolean
}

/** `GET /backups`: where they are and the ones kept, newest first. */
export interface BackupsDTO {
  /** Null when this copy makes no backups (BACKUPS=off, or no backups bucket bound). */
  where: BackupPlaceDTO | null
  /** How many daily (and manual) backups are kept. */
  keep: number
  backups: BackupDTO[]
}

/** `GET /auth/session` for visitors without a session. */
export interface AnonymousSessionDTO extends AccessStateDTO {
  user: null
  workspaces: []
}

/** Returned once when the copy is claimed, recovered or its access key is replaced. */
export interface AccessKeyDTO {
  accessKey: string
}

export interface ClaimResultDTO extends AccessKeyDTO {
  user: UserDTO
}

export interface ProjectDTO {
  id: string
  workspaceId: string
  name: string
  color: PaletteColor
  description: string | null
  position: string
  createdAt: string
  updatedAt: string
}

export interface BoardRefDTO {
  id: string
  projectId: string
  name: string
  position: string
  cardCount: number
}

export interface PageNodeDTO {
  id: string
  projectId: string
  parentId: string | null
  title: string
  icon: string | null
  position: string
  updatedAt: string
}

export interface ProjectTreeDTO extends ProjectDTO {
  boards: BoardRefDTO[]
  pages: PageNodeDTO[]
}

export interface OverviewDTO {
  workspace: WorkspaceDTO
  projects: ProjectTreeDTO[]
}

export interface LabelDTO {
  id: string
  boardId: string
  name: string
  color: PaletteColor
}

export interface ColumnDTO {
  id: string
  boardId: string
  name: string
  position: string
}

/** A column within a board: also how many archived cards it holds, which are deleted with it. */
export interface BoardColumnDTO extends ColumnDTO {
  archivedCards: number
}

export interface CardSummaryDTO {
  id: string
  boardId: string
  columnId: string
  title: string
  position: string
  dueAt: string | null
  labelIds: string[]
  hasDescription: boolean
  /** Version of the description: it goes up each time the description changes. */
  version: number
  checklist: { done: number; total: number }
  linkedPages: number
  attachments: number
  createdBy: ActorRef | null
  createdAt: string
  updatedAt: string
  /** When it was archived; null while it is on the board. */
  archivedAt: string | null
}

/** Archived cards come a page at a time, the most recently archived first. */
export const ARCHIVED_PAGE = 50

export interface BoardDTO {
  id: string
  projectId: string
  workspaceId: string
  name: string
  project: { id: string; name: string; color: PaletteColor }
  columns: BoardColumnDTO[]
  cards: CardSummaryDTO[]
  labels: LabelDTO[]
}

export interface ChecklistItemDTO {
  id: string
  checklistId: string
  text: string
  done: boolean
  position: string
}

export interface ChecklistDTO {
  id: string
  cardId: string
  title: string
  position: string
  items: ChecklistItemDTO[]
}

export interface LinkedPageDTO {
  id: string
  title: string
  icon: string | null
  projectId: string
  sources: Array<'manual' | 'mention'>
}

export interface AttachmentDTO {
  id: string
  filename: string
  mimeType: string
  size: number
  url: string
  isImage: boolean
  createdAt: string
}

export type EntityType = 'project' | 'board' | 'column' | 'card' | 'label' | 'page'

export interface ActivityDTO {
  id: string
  action: string
  entityType: EntityType
  entityId: string
  summary: string
  actor: ActorRef
  meta: Record<string, string | number | boolean | null>
  createdAt: string
  /** What it is about is in the trash now: its key there, to open it in the trash instead. */
  inTrash?: string
}

export interface CardDetailDTO extends CardSummaryDTO {
  workspaceId: string
  description: string
  archivedAt: string | null
  column: { id: string; name: string }
  board: { id: string; name: string; projectId: string }
  labels: LabelDTO[]
  checklists: ChecklistDTO[]
  pages: LinkedPageDTO[]
  attachmentList: AttachmentDTO[]
  activity: ActivityDTO[]
}

export interface LinkedCardDTO {
  id: string
  title: string
  boardId: string
  boardName: string
  columnName: string
  dueAt: string | null
  archived: boolean
  sources: Array<'manual' | 'mention'>
}

export interface PageDTO {
  id: string
  projectId: string
  workspaceId: string
  parentId: string | null
  title: string
  icon: string | null
  content: string
  version: number
  createdAt: string
  updatedAt: string
  updatedBy: ActorRef | null
  project: { id: string; name: string; color: PaletteColor }
  breadcrumbs: Array<{ id: string; title: string; icon: string | null }>
  children: PageNodeDTO[]
  cards: LinkedCardDTO[]
  attachments: AttachmentDTO[]
}

export interface SearchResultDTO {
  type: 'card' | 'page'
  id: string
  title: string
  excerpt: string
  icon: string | null
  projectId: string
  projectName: string
  boardId: string | null
  boardName: string | null
  columnName: string | null
  /** A card found among the archived ones (only when asked to include them). */
  archived?: boolean
}

export interface HomeCardDTO extends CardSummaryDTO {
  boardName: string
  columnName: string
  projectId: string
  projectName: string
}

export interface HomeDTO {
  dueCards: HomeCardDTO[]
  recentPages: Array<PageNodeDTO & { projectName: string }>
  activity: ActivityDTO[]
}

export interface TokenDTO {
  id: string
  name: string
  workspaceId: string
  workspaceName: string
  prefix: string
  scopes: Scope[]
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  /** Set when an application connected through OAuth instead of with a pasted token. */
  oauth: { clientId: string; redirectUri: string } | null
}

export interface CreatedTokenDTO extends TokenDTO {
  /** Plaintext token. Returned exactly once, at creation time. */
  token: string
}

export interface VaultStateDTO {
  initialized: boolean
  kdf: KdfParams | null
  wrappedKey: string | null
  recoveryWrappedKey: string | null
  autoLockMinutes: number
  /** The vault key's version: items and new wrappings are only taken for this one. */
  keyVersion: number
}

/** What setting up a vault gives: its key's version, which the server takes items for, and when it locks. */
export interface VaultSetupDTO {
  keyVersion: number
  autoLockMinutes: number
}

export interface VaultItemRecordDTO {
  id: string
  data: string
  createdAt: string
  updatedAt: string
}

/** Payload pushed over Server-Sent Events after every mutation. */
export interface RealtimeEvent {
  action: string
  actor: ActorRef
  summary?: string
  boardId?: string
  cardId?: string
  pageId?: string
  projectId?: string
  version?: number
  /** Set when the sidebar tree (projects, boards, page titles) changed. */
  structure?: boolean
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown }
}

// ── OAuth (connecting MCP clients without pasting a token) ──────
/** An application asking for access, as the consent screen shows it. */
export interface OAuthClientDTO {
  id: string
  /** What the application calls itself; not verified. */
  name: string
  /** Host that published the application's metadata (Client ID Metadata Document); null when it registered itself. */
  publishedBy: string | null
  /** Where the browser returns once you decide. */
  redirectUri: string
}

/** An access the same application already has, so reconnecting can replace it instead of adding another. */
export interface OAuthExistingAccessDTO {
  workspaceId: string
  createdAt: string
  lastUsedAt: string | null
}

export type OAuthRequestDTO =
  | { kind: 'consent'; client: OAuthClientDTO; scopes: Scope[]; existing: OAuthExistingAccessDTO[] }
  /** Shown to the owner and never sent back: the application is unknown, or the return address is not its own. */
  | { kind: 'problem'; problem: 'unknown_client' | 'bad_redirect'; detail: string }
  /** The request cannot go ahead; the application is told why at this address. */
  | { kind: 'redirect'; redirect: string }

export interface OAuthDecisionDTO {
  redirect: string
}

// ── Trash ────────────────────────────────────────────────────────
/** What can be in the trash. Each entry holds one of these, with everything that was inside it. */
export const TRASH_KINDS = ['project', 'board', 'column', 'card', 'page', 'attachment', 'label', 'checklist', 'checklist_item', 'link'] as const
export type TrashKind = (typeof TRASH_KINDS)[number]

/** Days a deleted item stays in the trash before it is deleted for good. */
export const TRASH_DAYS = 30

/** What went to the trash along with the item itself, counted when it was deleted. */
export interface TrashContents {
  projects?: number
  boards?: number
  columns?: number
  cards?: number
  pages?: number
  attachments?: number
  checklists?: number
  items?: number
  labels?: number
  links?: number
}

/** Restoring several things at once: each one's plan, in the order asked, and whether all can go now. */
export interface TrashPlanManyDTO {
  plans: TrashPlanDTO[]
  ready: boolean
  /** Of those asked for, the ones that come back with another one (below it, or the other end of one of its relations), by key: with which. */
  cameWith?: Record<string, string>
  /** Of those asked for, the ones no longer in the trash. */
  missing?: string[]
}

/** What restoring several things at once brought back, in the order asked. */
export interface RestoredManyDTO {
  restored: RestoredDTO[]
}

/** What deleting several things for good takes: how many were picked, and everything that goes with them. */
export interface TrashPurgeSummaryDTO {
  count: number
  /** All that goes, the things picked included, by kind. */
  contents: TrashContents
  bytes: number
}

/** The answer to deleting something that goes to the trash. Null when there was nothing to delete. */
export interface TrashedDTO {
  trashId: string | null
}

export interface RestoredDTO {
  kind: TrashKind
  entityId: string
  /** Where it went back when that is not where it was: a place chosen, or one made anew ("Project › Board"). */
  movedTo: string | null
  /** Where to open it in the app, relative to the workspace (`b/<id>`, `d/<id>`, `p/<id>`). */
  path: string | null
  /** Where it is now, for people: "Project › Board › Column". */
  location?: string
  /** What came back with it (not counting it), and what stayed in the trash because it was left out. */
  restored?: number
  left?: number
  /** It did not come back yet: a link waits in the trash for this page, and comes back with it. */
  waitsFor?: string
}

// The trash as a tree. What was deleted hangs from what held it, also when that was deleted
// later: a card deleted before its board shows inside the board. Nodes are keyed `kind:id`
// (`link:<card id>:<page id>` for a link between a card and a page).

/** Where something in the trash goes back: its place is there, in the trash too, or deleted for good. */
export type TrashPlace = 'original' | 'trash' | 'gone'

export interface TrashNodeDTO {
  key: string
  kind: TrashKind
  entityId: string
  title: string
  /** What holds it in the trash; null at the top. */
  parentKey: string | null
  /** The deletion it went with. */
  trashId: string
  place: TrashPlace
  /** At the top: where it goes back ("Project › Board"), or, when that is gone, where it was. */
  location: string
  /** Deleted on its own, before what holds it. */
  earlier: boolean
  /** Everything below it, counted; and of that, what was deleted before on its own. */
  contents: TrashContents
  earlierContents: TrashContents
  /** Size of the files it holds, its own included. */
  bytes: number
  deletedBy: ActorRef
  deletedAt: string
  expiresAt: string
}

/** One thing in the trash with everything below it, and what holds it there (top first). */
export interface TrashTreeDTO {
  node: TrashNodeDTO
  /** Everything below it, parents before children, each in its place. */
  below: TrashNodeDTO[]
  /** What holds it in the trash, top first; empty at the top. */
  ancestors: { key: string; kind: TrashKind; title: string; trashId: string }[]
}

/** A container to put something restored in, when it goes somewhere else. */
export type TrashPlaceKind = 'project' | 'board' | 'column' | 'card' | 'page' | 'checklist'

export interface TrashPlanNodeDTO {
  key: string
  parentKey: string | null
  kind: TrashKind
  title: string
  earlier: boolean
  /** Comes back with this restore; left out ones stay in the trash. */
  included: boolean
}

/**
 * Something restored whose name is already used where it goes back (or that the person renamed
 * because of that): its own name, the one it would have, the name of what it goes into, and
 * whether that name is still taken there, and kept on purpose.
 */
export interface TrashConflictDTO {
  key: string
  kind: TrashKind
  original: string
  name: string
  where: string
  taken: boolean
  kept: boolean
}

/**
 * A relation of what comes back (a card's label, a link between a card and a page) whose other
 * end is not there: in the trash ('trash'; it can come back too, or else the relation waits for
 * it), deleted for good ('gone'; the relation is lost), or a label of another board than the
 * card's now ('other_board'; it does not apply). Grouped by the other end.
 */
export interface TrashRelationDTO {
  kind: 'label' | 'page' | 'card'
  /** The other end, by name ('' when it is gone), and its key while it is in the trash. */
  title: string
  key: string | null
  state: 'trash' | 'gone' | 'other_board'
  /** How many of what comes back have it, and the first of them by name. */
  count: number
  first: string
  /** For 'trash': whether it comes back too, and whether it can (where it goes is there). */
  included: boolean
  canInclude: boolean
}

export interface TrashPlanDTO {
  node: TrashNodeDTO
  /** It and everything below it, in tree order, each saying whether it comes back. */
  nodes: TrashPlanNodeDTO[]
  where: {
    place: TrashPlace
    /** How it goes back as asked: where it was, with its place recreated, or somewhere else. */
    to: 'original' | 'recreate' | 'other' | null
    /** What "recreate" brings back from the trash to hold it (only those, nothing else of them), top first; said whatever is asked. */
    path: { key: string; kind: TrashKind; title: string }[]
    /** What "recreate" makes anew because the original is deleted for good, top first. */
    create: { kind: TrashKind; title: string }[]
    canRecreate: boolean
    /** What it can be put in instead; empty when it can't go anywhere else. */
    choose: TrashPlaceKind[]
    /** Where it ends up, as asked: "Project › Board › Column". */
    location: string
  }
  conflicts: TrashConflictDTO[]
  relations: TrashRelationDTO[]
  /** Boards that would hold more columns than they take (MAX_COLUMNS), and how many. */
  limits: { board: string; count: number; max: number }[]
  /** Restoring as asked can go ahead; otherwise, what is missing: where to put it, which names, or room for columns. */
  ready: boolean
  missing: ('place' | 'names' | 'columns')[]
}

// ── History ──────────────────────────────────────────────────────
/**
 * What the history records, on pages and cards: each change with who made it, when, and the
 * value before and after. `*.created`, `*.deleted` and `*.restored` carry no values.
 */
export const HISTORY_KINDS = [
  'page.created',
  'page.title',
  'page.icon',
  'page.content',
  'page.moved',
  'page.deleted',
  'page.restored',
  'card.created',
  'card.title',
  'card.description',
  'card.due',
  'card.labels',
  'card.moved',
  'card.archived',
  'card.deleted',
  'card.restored',
  'card.linked',
  'card.unlinked',
  'checklist.created',
  'checklist.title',
  'checklist.deleted',
  'checklist.restored',
  'item.created',
  'item.text',
  'item.done',
  'item.deleted',
  'item.restored',
  'attachment.created',
  'attachment.deleted',
  'attachment.restored',
  'attachment.moved',
] as const
export type HistoryKind = (typeof HISTORY_KINDS)[number]

/** Kinds whose values are plain text: page bodies, descriptions, titles and the like. */
export const HISTORY_TEXT_KINDS: ReadonlySet<HistoryKind> = new Set([
  'page.title',
  'page.icon',
  'page.content',
  'card.title',
  'card.description',
  'card.due',
  'checklist.title',
  'item.text',
])

/** Kinds whose values are long texts: lists leave them out, and the entry itself has them. */
export const HISTORY_BODY_KINDS: ReadonlySet<HistoryKind> = new Set(['page.content', 'card.description'])

/** Days the history keeps each change, as the trash keeps what is deleted. */
export const HISTORY_DAYS = 30

/** A card's place: its board and column. */
export interface CardPlace {
  boardId: string
  columnId: string
}

/** A page's place: its project and the page it hangs from, or none at the top. */
export interface PagePlace {
  projectId: string
  parentId: string | null
}

/** Where an attachment is: on a card or on a page. */
export interface AttachmentPlace {
  cardId: string | null
  pageId: string | null
}

export type HistoryValue = string | boolean | string[] | CardPlace | PagePlace | AttachmentPlace | null

export type HistoryMeta = Record<string, string | number | boolean | null | string[]>

export interface HistoryEntryDTO {
  id: string
  entityType: 'page' | 'card'
  /** The page or card whose history this is. */
  entityId: string
  kind: HistoryKind
  /** The checklist, item, attachment or linked page the change is about, if not the page or card itself. */
  subjectId: string | null
  /** Left out (null) for long texts in lists; `GET /api/history/:id` has them. */
  before: HistoryValue
  after: HistoryValue
  /**
   * What the change looked like when it was made, for people: names of columns, labels,
   * pages and files (`from`, `to`, `added`, `removed`, `name`), lines added and removed
   * (`linesAdded`, `linesRemoved`), the trash entry (`trashId`).
   */
  meta: HistoryMeta
  actor: ActorRef
  /** Changes one person or agent made in one stretch of work share it. */
  batchId: string
  createdAt: string
  /** Edits of the same text by the same person in one stretch of work are one change. */
  updatedAt: string
}

// ── Undo ─────────────────────────────────────────────────────────
/**
 * How undoing a change stands: `ready` to undo; `conflict` when someone changed the same
 * thing since; `unchanged` when it is already as before (nothing to do); `impossible` when
 * what it needs is gone (`reason`).
 */
export type UndoStatus = 'ready' | 'conflict' | 'unchanged' | 'impossible'

export interface UndoPlanItemDTO {
  entryId: string
  kind: HistoryKind
  entityType: 'page' | 'card'
  entityId: string
  /** The page or card, by name, as it is now (or was, if it is gone). */
  entityTitle: string
  status: UndoStatus
  /** Why it can't be undone: the page or card is gone, its old place is (or is in the trash), or the trash entry is. */
  reason?: 'gone' | 'place_gone' | 'place_in_trash' | 'trash_gone' | 'refused'
  /** For 'place_in_trash': the key of its place in the trash, to restore it from there. */
  trashKey?: string
  /** For a conflict: who changed it since, and what it is now. */
  changedBy?: ActorRef | null
  current?: HistoryValue
}

/** Something an author changed that undoing from the history doesn't take back: it has no history. */
export interface UndoLeftDTO {
  entityType: 'project' | 'board' | 'column' | 'label'
  entityId: string
  /** Its name, as the latest of those changes left it. */
  title: string
  /** What they did to it, each once. */
  actions: ('created' | 'updated' | 'moved' | 'deleted')[]
  /** Its key in the trash, when it is there now. */
  trashKey?: string
}

export interface UndoResultDTO {
  /** False when nothing was done because there were conflicts to decide on first. */
  applied: boolean
  plan: UndoPlanItemDTO[]
  undone: number
  skipped: number
  failed: number
  /**
   * With `since`: the changes from there on that this batch leaves for the next one, the oldest,
   * as one batch covers up to 500. Ask again with `until` set to the plan's last entry.
   */
  remaining?: number
  /** With `since`: what the author changed from there on in projects, boards, columns and labels, which this doesn't undo. */
  left?: UndoLeftDTO[]
  /** How many more of those there are than `left` lists. */
  leftMore?: number
}
