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

export interface CardSummaryDTO {
  id: string
  boardId: string
  columnId: string
  title: string
  position: string
  dueAt: string | null
  labelIds: string[]
  hasDescription: boolean
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
  columns: ColumnDTO[]
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
