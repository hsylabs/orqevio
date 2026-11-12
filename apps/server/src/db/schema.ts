import { sql } from 'drizzle-orm'
import { type AnySQLiteColumn, check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * SQLite schema. The same schema runs on a local file (Node/Docker) and in a
 * Cloudflare Durable Object. Identifiers are random UUIDs stored as text, and
 * timestamps are milliseconds since the epoch.
 *
 * Fractional-index `position` keys must sort by byte value: SQLite's default
 * BINARY collation does exactly that.
 */
const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID())
const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' })
const createdAt = () => timestamp('created_at').notNull().$defaultFn(() => new Date())
const updatedAt = () => timestamp('updated_at').notNull().$defaultFn(() => new Date())
const position = (name: string) => text(name)

// ── Identity ─────────────────────────────────────────────────────
export const users = sqliteTable('users', {
  id: id(),
  name: text('name').notNull(),
  theme: text('theme', { enum: ['system', 'light', 'dark'] }).notNull().default('system'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/**
 * A copy of Orqevio has a single owner. The row exists once the copy is claimed
 * with the setup code; the owner then opens it with the generated access key.
 */
export const instance = sqliteTable(
  'instance',
  {
    /** Always 1: the table holds at most one row. */
    id: integer('id').primaryKey().default(1),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the normalised access key; the key itself is never stored. */
    accessKeyHash: text('access_key_hash').notNull(),
    /** SHA-256 of the setup code that claimed (or last recovered) the copy. */
    setupCodeHash: text('setup_code_hash').notNull(),
    claimedAt: timestamp('claimed_at').notNull().$defaultFn(() => new Date()),
    keyChangedAt: timestamp('key_changed_at').notNull().$defaultFn(() => new Date()),
  },
  (t) => [check('instance_single_row', sql`${t.id} = 1`)],
)

/**
 * Small facts about the copy itself that must survive restarts (and, on
 * Cloudflare, Durable Object hibernation), such as the last update check.
 */
export const copyState = sqliteTable('copy_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: updatedAt(),
})

export const sessions = sqliteTable(
  'sessions',
  {
    /** SHA-256 of the cookie token; the token itself is never stored. */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at').notNull().$defaultFn(() => new Date()),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

export const workspaces = sqliteTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const workspaceMembers = sqliteTable(
  'workspace_members',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'editor'] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index('workspace_members_user_idx').on(t.userId)],
)

export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    prefix: text('prefix').notNull(),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at'),
    expiresAt: timestamp('expires_at'),
    revokedAt: timestamp('revoked_at'),
  },
  (t) => [uniqueIndex('api_tokens_hash_idx').on(t.tokenHash), index('api_tokens_user_idx').on(t.userId)],
)

// ── Projects & boards ────────────────────────────────────────────
export const projects = sqliteTable(
  'projects',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull(),
    description: text('description'),
    position: position('position').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('projects_workspace_idx').on(t.workspaceId)],
)

export const boards = sqliteTable(
  'boards',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: position('position').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('boards_project_idx').on(t.projectId)],
)

export const columns = sqliteTable(
  'board_columns',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: position('position').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('columns_board_idx').on(t.boardId)],
)

export const cards = sqliteTable(
  'cards',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    columnId: text('column_id')
      .notNull()
      .references(() => columns.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    position: position('position').notNull(),
    dueAt: timestamp('due_at'),
    archivedAt: timestamp('archived_at'),
    createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdByTokenId: text('created_by_token_id').references(() => apiTokens.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('cards_column_idx').on(t.columnId, t.position),
    index('cards_board_idx').on(t.boardId),
    index('cards_due_idx').on(t.workspaceId, t.dueAt),
  ],
)

export const labels = sqliteTable(
  'labels',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('labels_board_idx').on(t.boardId)],
)

export const cardLabels = sqliteTable(
  'card_labels',
  {
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.labelId] }), index('card_labels_label_idx').on(t.labelId)],
)

export const checklists = sqliteTable(
  'checklists',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    position: position('position').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('checklists_card_idx').on(t.cardId)],
)

export const checklistItems = sqliteTable(
  'checklist_items',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    checklistId: text('checklist_id')
      .notNull()
      .references(() => checklists.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    done: integer('done', { mode: 'boolean' }).notNull().default(false),
    position: position('position').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('checklist_items_checklist_idx').on(t.checklistId)],
)

// ── Documents ────────────────────────────────────────────────────
export const pages = sqliteTable(
  'pages',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): AnySQLiteColumn => pages.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default(''),
    icon: text('icon'),
    content: text('content').notNull().default(''),
    version: integer('version').notNull().default(1),
    position: position('position').notNull(),
    createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdByTokenId: text('created_by_token_id').references(() => apiTokens.id, { onDelete: 'set null' }),
    updatedByUserId: text('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    updatedByTokenId: text('updated_by_token_id').references(() => apiTokens.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('pages_project_idx').on(t.projectId, t.parentId),
    // Deleting a page cascades to its children: without this index each delete scans every page.
    index('pages_parent_idx').on(t.parentId),
    index('pages_workspace_updated_idx').on(t.workspaceId, t.updatedAt),
  ],
)

export const cardPageLinks = sqliteTable(
  'card_page_links',
  {
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    pageId: text('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** `manual`: linked explicitly. `mention`: referenced inside the page body. */
    source: text('source', { enum: ['manual', 'mention'] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.pageId, t.source] }), index('card_page_links_page_idx').on(t.pageId)],
)

export const attachments = sqliteTable(
  'attachments',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    pageId: text('page_id').references(() => pages.id, { onDelete: 'cascade' }),
    cardId: text('card_id').references(() => cards.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    storageKey: text('storage_key').notNull(),
    createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('attachments_page_idx').on(t.pageId), index('attachments_card_idx').on(t.cardId)],
)

// ── Activity (audit trail for people and agents) ─────────────────
export const activity = sqliteTable(
  'activity',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    actorKind: text('actor_kind', { enum: ['user', 'agent'] }).notNull(),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorTokenId: text('actor_token_id').references(() => apiTokens.id, { onDelete: 'set null' }),
    actorName: text('actor_name').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    summary: text('summary').notNull(),
    meta: text('meta', { mode: 'json' }).$type<Record<string, string | number | boolean | null>>().notNull().$defaultFn(() => ({})),
    createdAt: createdAt(),
  },
  (t) => [
    index('activity_workspace_idx').on(t.workspaceId, t.createdAt),
    index('activity_entity_idx').on(t.entityId, t.createdAt),
    index('activity_token_idx').on(t.actorTokenId, t.createdAt),
  ],
)

// ── Vault (ciphertext only; keys never reach the server) ─────────
export const vaults = sqliteTable('vaults', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  kdf: text('kdf', { mode: 'json' }).$type<{
    algorithm: 'argon2id'
    salt: string
    memoryKiB: number
    iterations: number
    parallelism: number
  }>(),
  wrappedKey: text('wrapped_key'),
  recoveryWrappedKey: text('recovery_wrapped_key'),
  autoLockMinutes: integer('auto_lock_minutes').notNull().default(15),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const vaultItems = sqliteTable(
  'vault_items',
  {
    /** Generated client-side so it can be bound into the AES-GCM associated data. */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    data: text('data').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('vault_items_user_idx').on(t.userId)],
)
