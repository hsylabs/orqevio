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
}

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
  boards?: number
  columns?: number
  cards?: number
  pages?: number
  attachments?: number
  checklists?: number
  items?: number
  labels?: number
}

export interface TrashEntryDTO {
  id: string
  kind: TrashKind
  /** The id the item had, and gets back when restored. */
  entityId: string
  title: string
  /** Where it was, for people: "Project › Board › Column". */
  location: string
  contents: TrashContents
  /** Size of the attachments it holds. */
  bytes: number
  deletedBy: ActorRef
  deletedAt: string
  expiresAt: string
}

/** The answer to deleting something that goes to the trash. Null when there was nothing to delete. */
export interface TrashedDTO {
  trashId: string | null
}

export interface RestoredDTO {
  kind: TrashKind
  entityId: string
  /** The original place no longer exists, so it was put in the first one available. */
  movedTo: string | null
  /** Where to open it in the app, relative to the workspace (`b/<id>`, `d/<id>`, `p/<id>`). */
  path: string | null
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

export type HistoryValue = string | boolean | string[] | CardPlace | PagePlace | null

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
  /** Why it can't be undone: the page or card is gone, its old place is, or the trash entry is. */
  reason?: 'gone' | 'place_gone' | 'trash_gone' | 'refused'
  /** For a conflict: who changed it since, and what it is now. */
  changedBy?: ActorRef | null
  current?: HistoryValue
}

export interface UndoResultDTO {
  /** False when nothing was done because there were conflicts to decide on first. */
  applied: boolean
  plan: UndoPlanItemDTO[]
  undone: number
  skipped: number
  failed: number
}
