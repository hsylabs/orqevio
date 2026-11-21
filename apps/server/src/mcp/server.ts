import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { type CallToolResult, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { type CommentDTO, DUE_DATE_HINT, MAX_COMMENT, MAX_MARKDOWN, PALETTE, TRASH_DAYS, dueDay } from '@orqevio/shared'
import { z } from 'zod'
import type { AgentActor } from '../auth/actor'
import { hasScope } from '../auth/actor'
import { AppError } from '../lib/errors'
import type { Services } from '../services'
import { VERSION } from '../version'

export const MCP_SERVER_NAME = 'orqevio'
export const MCP_SERVER_VERSION = VERSION

/** Largest file an agent uploads through MCP, and the request that carries it (base64 adds a third). */
export const MCP_UPLOAD_MB = 5
export const MCP_MAX_REQUEST_BYTES = 8 * 1024 * 1024

const INSTRUCTIONS = `Orqevio is a workspace that combines Kanban task boards and Markdown documents.
Structure: workspace → projects → boards (columns → cards) and documents (nested pages).

How to work with it:
- Start with list_projects to discover project, board and page ids. Use get_board to see columns, cards and labels.
- Boards and documents live in projects. If the workspace has none yet, create one with create_project (needs write access to tasks or documents).
- All ids are UUIDs returned by the tools; never invent them.
- Card descriptions and page contents are GitHub-flavoured Markdown.
- To reference a card inside a document write a Markdown link: [Card title](/card/<card_id>). To reference a page: [Page title](/doc/<page_id>). Card references inside a page automatically link that card to the page.
- update_page with mode "replace" should include base_version (from read_page) to avoid overwriting someone else's edits. Use mode "append" to add content safely.
- Likewise, update_card with a description should include base_version (the version from get_card).
- To leave a note for people on a card (progress, a question, a result), use add_comment rather than editing its description. get_card shows the latest comments; list_comments pages through older ones. You can change or delete only the comments written with this same access.
- Every change is recorded in the history of its card or page, and people can undo it from there.
- When a card is done or no longer needed, prefer archive_card: it leaves the board but stays findable. Delete what was a mistake or a duplicate.
- Tokens allowed to delete and move also have delete_* tools, move_attachment and move_card to another board. Deleting always moves things to the trash, where a person can bring them back for ${TRASH_DAYS} days. Agents can never empty the trash or delete anything for good.
- Attachments: get_card and read_page list them. read_attachment returns text files as text and images as images. upload_attachment takes text or base64, up to ${MCP_UPLOAD_MB} MB.
- The user's password vault is end-to-end encrypted and is never accessible through this server. Do not ask for passwords or secrets.`

const uuid = z.uuid()
/** Text files read back as text up to this size; images up to the upload size. */
const READ_TEXT_BYTES = 1024 * 1024
const TEXT_TYPES = /^(text\/|application\/(json|xml|yaml|x-yaml|csv|javascript|x-ndjson)\b)|\+(json|xml)$/
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/** Reads a stream to the end, stopping past `max` bytes. */
async function readAll(body: ReadableStream<Uint8Array>, max: number) {
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = body.getReader()
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    size += next.value.byteLength
    if (size > max) {
      await reader.cancel()
      throw new AppError(413, 'file_too_large', 'The file is too large to read here; open it in the Orqevio app.')
    }
    chunks.push(next.value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}

const attachmentSummary = (a: { id: string; filename: string; mimeType: string; size: number }) => ({ id: a.id, name: a.filename, type: a.mimeType, size: a.size })
/** The comments get_card shows, the newest; list_comments gives the rest. */
const CARD_COMMENTS = 10
const dueDate = z
  .string()
  .describe('Due date: the day as YYYY-MM-DD (a full ISO 8601 date-time also works; its date is the day). Use null to clear it.')

/** A due date as the day it names, stored at 12:00 UTC; anything else is refused, never guessed. */
function normaliseDue(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value
  const day = dueDay(value)
  if (!day) throw new AppError(400, 'bad_request', `Invalid due date "${value}": use ${DUE_DATE_HINT}.`)
  return day
}

const ok = (data: unknown): CallToolResult => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
})

function fail(error: unknown): CallToolResult {
  const message =
    error instanceof AppError
      ? error.message
      : 'Internal error while running the tool. The operation may not have been applied.'
  if (!(error instanceof AppError)) console.error('[mcp] tool failed', error)
  return { isError: true, content: [{ type: 'text', text: message }] }
}

async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn())
  } catch (error) {
    return fail(error)
  }
}

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const
/** Takes something away, to the trash: clients can ask the person first. */
const DELETE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const

/**
 * Builds an MCP server for one agent token. Only the tools permitted by the
 * token scopes are registered, and every call goes through the same services
 * (and permission checks) as the web app.
 */
export function createMcpServer(services: Services, actor: AgentActor) {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION }, { instructions: INSTRUCTIONS })
  const canReadTasks = hasScope(actor, 'tasks:read')
  const canWriteTasks = hasScope(actor, 'tasks:write')
  const canReadDocs = hasScope(actor, 'docs:read')
  const canWriteDocs = hasScope(actor, 'docs:write')
  /** Delete (to the trash) and move things to another board, card or page. */
  const canOrganize = hasScope(actor, 'organize') && (canWriteTasks || canWriteDocs)
  const ws = actor.workspaceId
  const commentSummary = (c: CommentDTO) => ({
    id: c.id,
    author: c.author.name,
    author_kind: c.author.kind,
    /** Written with this access: only those can it change or delete. */
    yours: c.author.kind === 'agent' && c.author.id === actor.tokenId,
    body: c.body,
    created_at: c.createdAt,
    edited_at: c.editedAt,
  })

  // ── Discovery ─────────────────────────────────────────────────
  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: 'Lists every project in the workspace with its boards and its document outline (ids, names, titles).',
      annotations: READ,
    },
    () =>
      run(async () => {
        const overview = await services.workspaces.overview(actor, ws)
        const empty = overview.projects.length === 0
        return {
          workspace: overview.workspace.name,
          ...(empty
            ? {
                hint:
                  canWriteTasks || canWriteDocs
                    ? 'This workspace has no projects yet. Create one with create_project, then add boards and documents to it.'
                    : 'This workspace has no projects yet, and this token cannot create one. Ask the person to create a project in the Orqevio app.',
              }
            : {}),
          projects: overview.projects.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            ...(canReadTasks ? { boards: p.boards.map((b) => ({ id: b.id, name: b.name, open_cards: b.cardCount })) } : {}),
            ...(canReadDocs
              ? { pages: p.pages.map((pg) => ({ id: pg.id, title: pg.title || 'Untitled', parent_id: pg.parentId })) }
              : {}),
          })),
        }
      }),
  )

  server.registerTool(
    'search',
    {
      title: 'Search',
      description: 'Full-text search across card titles, descriptions and comments, and page titles and contents, in the workspace.',
      inputSchema: {
        query: z.string().min(1).max(100),
        type: z.enum(['all', 'cards', 'pages']).default('all'),
        include_archived: z.boolean().default(false).describe('Also find archived cards, marked archived: true.'),
      },
      annotations: READ,
    },
    ({ query, type, include_archived }) =>
      run(async () => {
        const types = type === 'cards' ? (['card'] as const) : type === 'pages' ? (['page'] as const) : undefined
        const results = await services.search.search(actor, ws, query, { types: types ? [...types] : undefined, limit: 15, archived: include_archived })
        return results.map((r) =>
          r.type === 'card'
            ? {
                type: 'card',
                id: r.id,
                title: r.title,
                board: r.boardName,
                board_id: r.boardId,
                column: r.columnName,
                excerpt: r.excerpt,
                ...(r.comment ? { in_comment: { comment_id: r.comment.id, author: r.comment.author } } : {}),
                ...(r.archived ? { archived: true } : {}),
              }
            : { type: 'page', id: r.id, title: r.title || 'Untitled', project: r.projectName, excerpt: r.excerpt },
        )
      }),
  )

  // ── Projects ──────────────────────────────────────────────────
  if (canWriteTasks || canWriteDocs) {
    server.registerTool(
      'create_project',
      {
        title: 'Create project',
        description: 'Creates a project in the workspace, to hold boards and documents. Agents can create projects but not rename or delete them.',
        inputSchema: {
          name: z.string().min(1).max(80),
          description: z.string().max(500).optional(),
          color: z
            .union([z.enum(PALETTE), z.string().regex(/^#[0-9a-fA-F]{6}$/)])
            .optional()
            .describe(`One of ${PALETTE.join(', ')}, or a colour of its own as #rrggbb (to keep a colour from another tool). Cobalt if left out.`),
        },
        annotations: WRITE,
      },
      ({ name, description, color }) =>
        run(async () => {
          const project = await services.workspaces.createProject(actor, ws, { name, description, color })
          return { created: true, project_id: project.id, name: project.name }
        }),
    )
  }

  // ── Tasks: read ───────────────────────────────────────────────
  if (canReadTasks) {
    server.registerTool(
      'get_board',
      {
        title: 'Get board',
        description: 'Returns a board with its columns (in order), the open cards of each column (in order) and the board labels.',
        inputSchema: { board_id: uuid },
        annotations: READ,
      },
      ({ board_id }) =>
        run(async () => {
          const board = await services.boards.get(actor, board_id)
          const labelName = new Map(board.labels.map((l) => [l.id, l.name || l.color]))
          return {
            id: board.id,
            name: board.name,
            project: board.project.name,
            labels: board.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
            columns: board.columns.map((col) => ({
              id: col.id,
              name: col.name,
              cards: board.cards
                .filter((card) => card.columnId === col.id)
                .map((card) => ({
                  id: card.id,
                  title: card.title,
                  due: card.dueAt,
                  labels: card.labelIds.map((id) => labelName.get(id) ?? id),
                  checklist: card.checklist.total ? `${card.checklist.done}/${card.checklist.total}` : null,
                  linked_pages: card.linkedPages,
                  comments: card.comments,
                })),
            })),
          }
        }),
    )

    server.registerTool(
      'get_card',
      {
        title: 'Get card',
        description:
          `Returns a card in full: Markdown description and its version, labels, due date, checklists (with item ids), linked pages, attachments, its latest ${CARD_COMMENTS} comments (newest first; list_comments gives older ones) and recent activity.`,
        inputSchema: { card_id: uuid },
        annotations: READ,
      },
      ({ card_id }) =>
        run(async () => {
          const [card, comments] = await Promise.all([services.cards.detail(actor, card_id), services.comments.list(actor, card_id, { limit: CARD_COMMENTS })])
          return {
            id: card.id,
            title: card.title,
            board: { id: card.board.id, name: card.board.name },
            column: card.column,
            archived: card.archivedAt !== null,
            due: card.dueAt,
            labels: card.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
            description: card.description,
            version: card.version,
            checklists: card.checklists.map((cl) => ({
              id: cl.id,
              title: cl.title,
              items: cl.items.map((i) => ({ id: i.id, text: i.text, done: i.done })),
            })),
            linked_pages: card.pages.map((p) => ({ id: p.id, title: p.title || 'Untitled' })),
            attachments: card.attachmentList.map(attachmentSummary),
            comments: { total: comments.total, latest: comments.comments.map(commentSummary), more: comments.hasMore },
            recent_activity: card.activity.slice(0, 10).map((a) => ({ action: a.action, by: a.actor.name, at: a.createdAt })),
          }
        }),
    )

    server.registerTool(
      'list_comments',
      {
        title: 'List comments',
        description: 'Lists the comments on a card, newest first, a page at a time. For the next (older) page, pass the next_before of this one as before.',
        inputSchema: {
          card_id: uuid,
          before: z.string().max(100).optional().describe('The next_before of the previous page: list the comments written before its last one.'),
          limit: z.number().int().min(1).max(50).default(20),
        },
        annotations: READ,
      },
      ({ card_id, before, limit }) =>
        run(async () => {
          // When and which: a page goes on from there even if that comment was deleted since.
          const cursor = before === undefined ? undefined : /^(.+)\|([0-9a-f-]{36})$/i.exec(before)
          const at = cursor ? new Date(cursor[1]!) : undefined
          if (before !== undefined && (!cursor || Number.isNaN(at!.getTime()))) throw new AppError(400, 'bad_request', 'before must be the next_before of a previous page.')
          const page = await services.comments.list(actor, card_id, { before: at, beforeId: cursor?.[2], limit })
          const last = page.comments.at(-1)
          return { total: page.total, comments: page.comments.map(commentSummary), next_before: page.hasMore && last ? `${last.createdAt}|${last.id}` : null }
        }),
    )
  }

  // ── Tasks: write ──────────────────────────────────────────────
  if (canWriteTasks) {
    server.registerTool(
      'create_card',
      {
        title: 'Create card',
        description: `Creates a card in a column. description is Markdown, up to ${MAX_MARKDOWN} characters.`,
        inputSchema: {
          column_id: uuid,
          title: z.string().min(1).max(300),
          description: z.string().max(MAX_MARKDOWN).optional(),
          due_date: dueDate.optional(),
          label_ids: z.array(uuid).max(20).optional(),
          position: z.enum(['top', 'bottom']).default('bottom'),
        },
        annotations: WRITE,
      },
      (args) =>
        run(async () => {
          const card = await services.cards.create(actor, args.column_id, {
            title: args.title,
            description: args.description,
            dueAt: normaliseDue(args.due_date),
            labelIds: args.label_ids,
            index: args.position === 'top' ? 0 : undefined,
          })
          return { created: true, card_id: card.id, title: card.title }
        }),
    )

    server.registerTool(
      'update_card',
      {
        title: 'Update card',
        description:
          `Updates a card. Only the fields you send change. label_ids replaces the full label set. description is Markdown, up to ${MAX_MARKDOWN} characters; with it, send base_version (the version from get_card) to avoid overwriting newer edits.`,
        inputSchema: {
          card_id: uuid,
          title: z.string().min(1).max(300).optional(),
          description: z.string().max(MAX_MARKDOWN).optional(),
          base_version: z.number().int().min(1).optional(),
          due_date: dueDate.nullable().optional(),
          label_ids: z.array(uuid).max(20).optional(),
        },
        annotations: { ...WRITE, idempotentHint: true },
      },
      (args) =>
        run(async () => {
          const card = await services.cards.update(actor, args.card_id, {
            title: args.title,
            description: args.description,
            baseVersion: args.base_version,
            dueAt: normaliseDue(args.due_date),
            labelIds: args.label_ids,
          })
          return { updated: true, card_id: card.id, version: card.version }
        }),
    )

    server.registerTool(
      'move_card',
      {
        title: 'Move card',
        description: canOrganize
          ? 'Moves a card to a column of its board, or of another board of the workspace (it loses the labels of its old board). index 0 places it at the top; omit index to place it at the bottom.'
          : 'Moves a card to a column of the same board. index 0 places it at the top; omit index to place it at the bottom.',
        inputSchema: { card_id: uuid, column_id: uuid, index: z.number().int().min(0).optional() },
        annotations: { ...WRITE, idempotentHint: true },
      },
      ({ card_id, column_id, index }) =>
        run(async () => {
          await services.cards.move(actor, card_id, { columnId: column_id, index: index ?? 100_000 })
          return { moved: true, card_id, column_id }
        }),
    )

    server.registerTool(
      'archive_card',
      {
        title: 'Archive card',
        description: 'Archives a card (hides it from the board). A person can restore it from the app.',
        inputSchema: { card_id: uuid },
        annotations: { ...WRITE, idempotentHint: true },
      },
      ({ card_id }) =>
        run(async () => {
          await services.cards.setArchived(actor, card_id, true)
          return { archived: true, card_id }
        }),
    )

    server.registerTool(
      'create_board',
      {
        title: 'Create board',
        description: 'Creates a Kanban board in a project. Without columns it gets three, To do, In progress and Done, named in the owner’s language.',
        inputSchema: { project_id: uuid, name: z.string().min(1).max(80), columns: z.array(z.string().min(1).max(60)).max(20).optional() },
        annotations: WRITE,
      },
      ({ project_id, name, columns }) =>
        run(async () => {
          const board = await services.boards.create(actor, project_id, { name, columns })
          const full = await services.boards.get(actor, board.id)
          return { created: true, board_id: board.id, columns: full.columns.map((c) => ({ id: c.id, name: c.name })) }
        }),
    )

    server.registerTool(
      'create_column',
      {
        title: 'Create column',
        description: 'Adds a column to a board. index 0 makes it the first column; omit to append it at the end.',
        inputSchema: { board_id: uuid, name: z.string().min(1).max(60), index: z.number().int().min(0).optional() },
        annotations: WRITE,
      },
      ({ board_id, name, index }) =>
        run(async () => {
          const column = await services.boards.createColumn(actor, board_id, { name, index })
          return { created: true, column_id: column.id }
        }),
    )

    server.registerTool(
      'update_column',
      {
        title: 'Update column',
        description: 'Renames and/or reorders a column (index 0 = first).',
        inputSchema: { column_id: uuid, name: z.string().min(1).max(60).optional(), index: z.number().int().min(0).optional() },
        annotations: { ...WRITE, idempotentHint: true },
      },
      ({ column_id, name, index }) =>
        run(async () => {
          const column = await services.boards.updateColumn(actor, column_id, { name, index })
          return { updated: true, column_id: column.id, name: column.name }
        }),
    )

    server.registerTool(
      'create_label',
      {
        title: 'Create label',
        description: 'Creates a label on a board.',
        inputSchema: { board_id: uuid, name: z.string().max(40), color: z.enum(PALETTE) },
        annotations: WRITE,
      },
      ({ board_id, name, color }) =>
        run(async () => {
          const label = await services.boards.createLabel(actor, board_id, { name, color })
          return { created: true, label_id: label.id }
        }),
    )

    server.registerTool(
      'create_checklist',
      {
        title: 'Create checklist',
        description: 'Creates an empty checklist on a card. To create one with items, use add_checklist_items with checklist_title instead.',
        inputSchema: { card_id: uuid, title: z.string().min(1).max(120) },
        annotations: WRITE,
      },
      ({ card_id, title }) =>
        run(async () => {
          const checklist = await services.cards.createChecklist(actor, card_id, { title })
          return { created: true, checklist_id: checklist.id, title: checklist.title }
        }),
    )

    server.registerTool(
      'add_checklist_items',
      {
        title: 'Add checklist items',
        description:
          'Adds items to a checklist of a card. Pass checklist_id to use an existing checklist; otherwise a new checklist is created with checklist_title. For an empty checklist, use create_checklist.',
        inputSchema: {
          card_id: uuid,
          items: z.array(z.string().min(1).max(500)).min(1).max(50),
          checklist_id: uuid.optional(),
          checklist_title: z.string().min(1).max(120).optional(),
        },
        annotations: WRITE,
      },
      (args) =>
        run(async () => {
          // All or nothing: an item that is not valid leaves the card as it was.
          const { checklistId, items } = await services.cards.addItems(actor, args.card_id, {
            checklistId: args.checklist_id,
            checklistTitle: args.checklist_title,
            items: args.items,
          })
          return { checklist_id: checklistId, items }
        }),
    )

    server.registerTool(
      'update_checklist_item',
      {
        title: 'Update checklist item',
        description: 'Checks/unchecks or renames a checklist item.',
        inputSchema: { item_id: uuid, done: z.boolean().optional(), text: z.string().min(1).max(500).optional() },
        annotations: { ...WRITE, idempotentHint: true },
      },
      ({ item_id, done, text }) =>
        run(async () => {
          const item = await services.cards.updateItem(actor, item_id, { done, text })
          return { updated: true, item_id: item.id, done: item.done }
        }),
    )

    server.registerTool(
      'add_comment',
      {
        title: 'Add comment',
        description: `Adds a comment to a card, signed with this access's name, for people to read: progress, a question, a result. body is Markdown, up to ${MAX_COMMENT} characters.`,
        inputSchema: { card_id: uuid, body: z.string().min(1).max(MAX_COMMENT) },
        annotations: WRITE,
      },
      ({ card_id, body }) =>
        run(async () => {
          const comment = await services.comments.create(actor, card_id, { body })
          return { created: true, comment_id: comment.id }
        }),
    )

    server.registerTool(
      'update_comment',
      {
        title: 'Update comment',
        description: `Replaces the text of a comment written with this access (others' comments, and those written with an earlier access, can't be changed). body is Markdown, up to ${MAX_COMMENT} characters.`,
        inputSchema: { comment_id: uuid, body: z.string().min(1).max(MAX_COMMENT) },
        annotations: { ...WRITE, idempotentHint: true },
      },
      ({ comment_id, body }) =>
        run(async () => {
          const comment = await services.comments.update(actor, comment_id, { body })
          return { updated: true, comment_id: comment.id, edited_at: comment.editedAt }
        }),
    )
  }

  // ── Documents ─────────────────────────────────────────────────
  if (canReadDocs) {
    server.registerTool(
      'list_pages',
      {
        title: 'List pages',
        description: 'Returns the page tree of a project as an indented outline with page ids.',
        inputSchema: { project_id: uuid },
        annotations: READ,
      },
      ({ project_id }) =>
        run(async () => {
          const nodes = await services.pages.tree(actor, project_id)
          const lines: string[] = []
          const walk = (parentId: string | null, depth: number) => {
            for (const node of nodes.filter((n) => n.parentId === parentId)) {
              lines.push(`${'  '.repeat(depth)}- ${node.title || 'Untitled'} (id: ${node.id})`)
              if (depth < 20) walk(node.id, depth + 1)
            }
          }
          walk(null, 0)
          return lines.length ? lines.join('\n') : 'This project has no pages yet.'
        }),
    )

    server.registerTool(
      'read_page',
      {
        title: 'Read page',
        description: 'Returns a page as Markdown with its version, sub-pages and linked cards.',
        inputSchema: { page_id: uuid },
        annotations: READ,
      },
      ({ page_id }) =>
        run(async () => {
          const page = await services.pages.get(actor, page_id)
          const header = [
            `# ${page.title || 'Untitled'}`,
            '',
            `page_id: ${page.id}`,
            `version: ${page.version}`,
            `project: ${page.project.name}`,
            `updated: ${page.updatedAt}${page.updatedBy ? ` by ${page.updatedBy.name}` : ''}`,
            page.children.length ? `sub_pages: ${page.children.map((c) => `${c.title || 'Untitled'} (${c.id})`).join(', ')}` : null,
            page.cards.length ? `linked_cards: ${page.cards.map((c) => `${c.title} (${c.id}, ${c.columnName})`).join(', ')}` : null,
            page.attachments.length ? `attachments: ${page.attachments.map((a) => `${a.filename} (${a.id}, ${a.mimeType}, ${a.size} bytes)`).join(', ')}` : null,
            '',
            '---',
            '',
          ].filter((l) => l !== null)
          return `${header.join('\n')}${page.content || '(empty page)'}`
        }),
    )
  }

  if (canWriteDocs) {
    server.registerTool(
      'create_page',
      {
        title: 'Create page',
        description: 'Creates a page in a project, optionally nested under parent_id. content is Markdown.',
        inputSchema: {
          project_id: uuid,
          title: z.string().min(1).max(200),
          content: z.string().max(MAX_MARKDOWN).optional(),
          parent_id: uuid.optional(),
        },
        annotations: WRITE,
      },
      ({ project_id, title, content, parent_id }) =>
        run(async () => {
          const page = await services.pages.create(actor, project_id, { title, content: content ?? '', parentId: parent_id ?? null })
          return { created: true, page_id: page.id, version: 1 }
        }),
    )

    server.registerTool(
      'update_page',
      {
        title: 'Update page',
        description:
          `Updates a page title, icon and/or Markdown content. mode "replace" overwrites the content (send base_version from read_page to avoid overwriting newer edits); mode "append" adds content at the end. A page holds up to ${MAX_MARKDOWN} characters, also after appending.`,
        inputSchema: {
          page_id: uuid,
          title: z.string().max(200).optional(),
          icon: z.string().max(16).nullable().optional().describe('An emoji for the page, or null to remove it.'),
          content: z.string().max(MAX_MARKDOWN).optional(),
          mode: z.enum(['replace', 'append']).default('replace'),
          base_version: z.number().int().min(1).optional(),
        },
        annotations: WRITE,
      },
      ({ page_id, title, icon, content, mode, base_version }) =>
        run(async () => {
          const result = await services.pages.update(
            actor,
            page_id,
            { title, icon, content, baseVersion: base_version },
            { allowBlindWrite: true, append: mode === 'append' && content !== undefined },
          )
          return { updated: true, page_id: result.id, version: result.version }
        }),
    )

    server.registerTool(
      'move_page',
      {
        title: 'Move page',
        description: 'Moves a page, with its sub-pages, under another page of the same project, or to the top level with parent_id null. index 0 makes it the first; omit to place it last.',
        inputSchema: { page_id: uuid, parent_id: uuid.nullable(), index: z.number().int().min(0).optional() },
        annotations: { ...WRITE, idempotentHint: true },
      },
      ({ page_id, parent_id, index }) =>
        run(async () => {
          await services.pages.move(actor, page_id, { parentId: parent_id, index: index ?? 100_000 })
          return { moved: true, page_id, parent_id }
        }),
    )
  }

  // ── Attachments ───────────────────────────────────────────────
  if (canWriteTasks || canWriteDocs) {
    server.registerTool(
      'upload_attachment',
      {
        title: 'Upload attachment',
        description: `Attaches a file to a card or a page (send card_id or page_id). content is the file itself: plain text, or base64 with encoding "base64". Up to ${MCP_UPLOAD_MB} MB.`,
        inputSchema: {
          card_id: uuid.optional(),
          page_id: uuid.optional(),
          filename: z.string().min(1).max(180),
          mime_type: z.string().max(120).optional().describe('For example text/markdown or image/png. Guessed from the content when omitted.'),
          content: z.string().min(1),
          encoding: z.enum(['text', 'base64']).default('text'),
        },
        annotations: WRITE,
      },
      (args) =>
        run(async () => {
          if ((args.card_id === undefined) === (args.page_id === undefined)) throw new AppError(400, 'bad_request', 'Send either card_id or page_id')
          const bytes = args.encoding === 'base64' ? fromBase64(args.content) : new TextEncoder().encode(args.content)
          if (bytes.byteLength > MCP_UPLOAD_MB * 1024 * 1024) throw new AppError(413, 'file_too_large', `Files uploaded by agents are limited to ${MCP_UPLOAD_MB} MB`)
          const type = args.mime_type ?? (args.encoding === 'text' ? 'text/plain; charset=utf-8' : 'application/octet-stream')
          const body = new Blob([bytes]).stream()
          const target = args.page_id ? { pageId: args.page_id } : { cardId: args.card_id! }
          const file = await services.attachments.upload(actor, target, { body, size: bytes.byteLength, name: args.filename, type })
          return { uploaded: true, attachment: attachmentSummary(file) }
        }),
    )
  }

  if (canReadTasks || canReadDocs) {
    server.registerTool(
      'read_attachment',
      {
        title: 'Read attachment',
        description: 'Reads an attachment of a card or a page: text files (up to 1 MB) come back as text and images as images; for other files, what they are.',
        inputSchema: { attachment_id: uuid },
        annotations: READ,
      },
      async ({ attachment_id }) => {
        try {
          const { meta, body } = await services.attachments.open(actor, attachment_id)
          const about = attachmentSummary(meta)
          const type = meta.mimeType.split(';')[0]!.trim().toLowerCase()
          if (TEXT_TYPES.test(type) && meta.size <= READ_TEXT_BYTES) {
            const text = new TextDecoder().decode(await readAll(body, READ_TEXT_BYTES))
            return { content: [{ type: 'text', text: JSON.stringify(about) }, { type: 'text', text }] }
          }
          if (IMAGE_TYPES.has(type) && meta.size <= MCP_UPLOAD_MB * 1024 * 1024) {
            const data = Buffer.from(await readAll(body, MCP_UPLOAD_MB * 1024 * 1024)).toString('base64')
            return { content: [{ type: 'text', text: JSON.stringify(about) }, { type: 'image', data, mimeType: type }] }
          }
          await body.cancel()
          return ok({ ...about, note: 'This file cannot be read here; a person can open it in the Orqevio app.' })
        } catch (error) {
          return fail(error)
        }
      },
    )
  }

  // ── Delete (to the trash) and move elsewhere ──────────────────
  if (canOrganize) {
    const remove = (name: string, title: string, description: string, input: Record<string, z.ZodType>, fn: (args: Record<string, string>) => Promise<unknown>) =>
      server.registerTool(name, { title, description: `${description} A person can bring it back from the trash for ${TRASH_DAYS} days.`, inputSchema: input, annotations: DELETE }, (args) =>
        run(async () => ({ deleted: true, trash_id: await fn(args as Record<string, string>) })),
      )

    if (canWriteTasks) {
      remove('delete_card', 'Delete card', 'Moves a card to the trash, with its checklists, comments, links and attachments.', { card_id: uuid }, (a) => services.cards.remove(actor, a.card_id!))
      remove('delete_board', 'Delete board', 'Moves a board to the trash, with its columns and cards.', { board_id: uuid }, (a) => services.boards.remove(actor, a.board_id!))
      remove('delete_column', 'Delete column', 'Moves a column to the trash, with all its cards.', { column_id: uuid }, (a) => services.boards.removeColumn(actor, a.column_id!))
      remove('delete_label', 'Delete label', 'Moves a label of a board to the trash; it comes off every card that had it.', { label_id: uuid }, (a) => services.boards.removeLabel(actor, a.label_id!))
      remove('delete_checklist', 'Delete checklist', 'Moves a checklist of a card to the trash, with its items.', { checklist_id: uuid }, (a) => services.cards.removeChecklist(actor, a.checklist_id!))
      remove('delete_checklist_item', 'Delete checklist item', 'Moves a checklist item to the trash.', { item_id: uuid }, (a) => services.cards.removeItem(actor, a.item_id!))
      remove('delete_comment', 'Delete comment', "Moves a comment written with this access to the trash (others' comments can't be deleted).", { comment_id: uuid }, (a) => services.comments.remove(actor, a.comment_id!))
    }
    if (canWriteDocs) {
      remove('delete_page', 'Delete page', 'Moves a page to the trash, with its sub-pages and attachments.', { page_id: uuid }, (a) => services.pages.remove(actor, a.page_id!))
    }
    if (canWriteTasks && canWriteDocs) {
      remove('delete_project', 'Delete project', 'Moves a project to the trash, with all its boards and documents.', { project_id: uuid }, (a) => services.workspaces.removeProject(actor, a.project_id!))
    }
    remove('delete_attachment', 'Delete attachment', 'Moves an attachment of a card or a page to the trash.', { attachment_id: uuid }, (a) => services.attachments.remove(actor, a.attachment_id!))
    if (canReadTasks && canReadDocs) {
      remove('unlink_card_from_page', 'Unlink card from page', 'Removes the link between a card and a page that link_card_to_page made (links from card references in the page stay while the reference is there).', { card_id: uuid, page_id: uuid }, (a) =>
        services.cards.unlinkPage(actor, a.card_id!, a.page_id!),
      )
    }

    server.registerTool(
      'move_attachment',
      {
        title: 'Move attachment',
        description: 'Moves an attachment to another card or page of the workspace (send card_id or page_id).',
        inputSchema: { attachment_id: uuid, card_id: uuid.optional(), page_id: uuid.optional() },
        annotations: { ...WRITE, idempotentHint: true },
      },
      ({ attachment_id, card_id, page_id }) =>
        run(async () => {
          const moved = await services.attachments.move(actor, attachment_id, { cardId: card_id, pageId: page_id })
          return { moved: true, attachment: attachmentSummary(moved), card_id: card_id ?? null, page_id: page_id ?? null }
        }),
    )
  }

  if ((canWriteTasks || canWriteDocs) && canReadTasks && canReadDocs) {
    server.registerTool(
      'link_card_to_page',
      {
        title: 'Link card to page',
        description: 'Creates an explicit link between a card and a page so each shows the other.',
        inputSchema: { card_id: uuid, page_id: uuid },
        annotations: { ...WRITE, idempotentHint: true },
      },
      ({ card_id, page_id }) =>
        run(async () => {
          await services.cards.linkPage(actor, card_id, { pageId: page_id })
          return { linked: true, card_id, page_id }
        }),
    )
  }

  invalidParamsForMalformedRequests(server)
  return server
}

/**
 * The bytes of base64 content, standard or URL-safe, spaces and line breaks allowed. Anything else
 * (a `data:` URL, text that was never encoded) is refused: decoded leniently, it would be stored as
 * a damaged file and reported uploaded.
 */
function fromBase64(content: string) {
  if (/^data:[^,]*,/i.test(content)) throw new AppError(400, 'bad_request', 'content is a data: URL: send only the base64 after the comma')
  const compact = content.replace(/\s+/g, '')
  const unpadded = compact.replace(/={1,2}$/, '')
  if (!/^[A-Za-z0-9+/]*$/.test(unpadded) && !/^[A-Za-z0-9_-]*$/.test(unpadded)) throw new AppError(400, 'bad_request', 'content is not valid base64')
  if (unpadded.length % 4 === 1 || (compact.length !== unpadded.length && compact.length % 4 !== 0)) throw new AppError(400, 'bad_request', 'content is not valid base64: its length is not that of encoded bytes')
  return Uint8Array.from(Buffer.from(unpadded, /[-_]/.test(unpadded) ? 'base64url' : 'base64'))
}

type RequestHandler = (request: unknown, extra: unknown) => Promise<unknown>

/**
 * The SDK checks each request against its schema before calling the handler, and answers one
 * that does not fit (`tools/call` without a `name`, say) with -32603, an internal error, and the
 * raw validation output. The mistake is the client's: -32602, invalid params, says so. Still so in
 * SDK 1.32.2; the handlers are in a private field, so if it moves this does nothing.
 */
function invalidParamsForMalformedRequests(server: McpServer) {
  const handlers = (server.server as unknown as { _requestHandlers?: unknown })._requestHandlers
  if (!(handlers instanceof Map)) return
  for (const [method, handler] of handlers as Map<string, RequestHandler>) {
    handlers.set(method, async (request: unknown, extra: unknown) => {
      try {
        return await handler(request, extra)
      } catch (error) {
        const issues = (error as { issues?: Array<{ path: PropertyKey[]; message: string }> } | null)?.issues
        // `ZodError`, or `$ZodError` from the zod build the SDK uses.
        if (!/^\$?ZodError$/.test((error as Error | null)?.name ?? '') || !Array.isArray(issues)) throw error
        throw new McpError(ErrorCode.InvalidParams, issues.map((i) => `${i.path.map(String).join('.') || 'request'}: ${i.message}`).join('; '))
      }
    })
  }
}
