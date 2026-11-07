import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { PALETTE } from '@orqevio/shared'
import { z } from 'zod'
import type { AgentActor } from '../auth/actor'
import { hasScope } from '../auth/actor'
import { AppError } from '../lib/errors'
import type { Services } from '../services'

export const MCP_SERVER_NAME = 'orqevio'
export const MCP_SERVER_VERSION = '1.0.0'

const INSTRUCTIONS = `Orqevio is a workspace that combines Kanban task boards and Markdown documents.
Structure: workspace → projects → boards (columns → cards) and documents (nested pages).

How to work with it:
- Start with list_projects to discover project, board and page ids. Use get_board to see columns, cards and labels.
- All ids are UUIDs returned by the tools; never invent them.
- Card descriptions and page contents are GitHub-flavoured Markdown.
- To reference a card inside a document write a Markdown link: [Card title](/card/<card_id>). To reference a page: [Page title](/doc/<page_id>). Card references inside a page automatically link that card to the page.
- update_page with mode "replace" should include base_version (from read_page) to avoid overwriting someone else's edits. Use mode "append" to add content safely.
- Agents cannot delete anything. Use archive_card to remove a card from a board (it can be restored by a person).
- The user's password vault is end-to-end encrypted and is never accessible through this server. Do not ask for passwords or secrets.`

const uuid = z.uuid()
const dueDate = z
  .string()
  .describe('Due date as YYYY-MM-DD or a full ISO 8601 date-time. Use null to clear it.')

function normaliseDue(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T12:00:00.000Z`
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) throw new AppError(400, 'bad_request', `Invalid due date "${value}"`)
  return date.toISOString()
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
  const ws = actor.workspaceId

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
        return {
          workspace: overview.workspace.name,
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
      description: 'Full-text search across card titles/descriptions and page titles/contents in the workspace.',
      inputSchema: {
        query: z.string().min(1).max(100),
        type: z.enum(['all', 'cards', 'pages']).default('all'),
      },
      annotations: READ,
    },
    ({ query, type }) =>
      run(async () => {
        const types = type === 'cards' ? (['card'] as const) : type === 'pages' ? (['page'] as const) : undefined
        const results = await services.search.search(actor, ws, query, { types: types ? [...types] : undefined, limit: 15 })
        return results.map((r) =>
          r.type === 'card'
            ? { type: 'card', id: r.id, title: r.title, board: r.boardName, board_id: r.boardId, column: r.columnName, excerpt: r.excerpt }
            : { type: 'page', id: r.id, title: r.title || 'Untitled', project: r.projectName, excerpt: r.excerpt },
        )
      }),
  )

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
                })),
            })),
          }
        }),
    )

    server.registerTool(
      'get_card',
      {
        title: 'Get card',
        description: 'Returns a card in full: Markdown description, labels, due date, checklists (with item ids), linked pages and recent activity.',
        inputSchema: { card_id: uuid },
        annotations: READ,
      },
      ({ card_id }) =>
        run(async () => {
          const card = await services.cards.detail(actor, card_id)
          return {
            id: card.id,
            title: card.title,
            board: { id: card.board.id, name: card.board.name },
            column: card.column,
            archived: card.archivedAt !== null,
            due: card.dueAt,
            labels: card.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
            description: card.description,
            checklists: card.checklists.map((cl) => ({
              id: cl.id,
              title: cl.title,
              items: cl.items.map((i) => ({ id: i.id, text: i.text, done: i.done })),
            })),
            linked_pages: card.pages.map((p) => ({ id: p.id, title: p.title || 'Untitled' })),
            recent_activity: card.activity.slice(0, 10).map((a) => ({ action: a.action, by: a.actor.name, at: a.createdAt })),
          }
        }),
    )
  }

  // ── Tasks: write ──────────────────────────────────────────────
  if (canWriteTasks) {
    server.registerTool(
      'create_card',
      {
        title: 'Create card',
        description: 'Creates a card in a column. Description is Markdown.',
        inputSchema: {
          column_id: uuid,
          title: z.string().min(1).max(300),
          description: z.string().max(50_000).optional(),
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
        description: 'Updates a card. Only the fields you send change. label_ids replaces the full label set.',
        inputSchema: {
          card_id: uuid,
          title: z.string().min(1).max(300).optional(),
          description: z.string().max(50_000).optional(),
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
            dueAt: normaliseDue(args.due_date),
            labelIds: args.label_ids,
          })
          return { updated: true, card_id: card.id }
        }),
    )

    server.registerTool(
      'move_card',
      {
        title: 'Move card',
        description: 'Moves a card to a column of the same board. index 0 places it at the top; omit index to place it at the bottom.',
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
        description: 'Creates a Kanban board in a project. Without columns it gets "Por hacer", "En curso" and "Hecho".',
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
      'add_checklist_items',
      {
        title: 'Add checklist items',
        description:
          'Adds items to a checklist of a card. Pass checklist_id to use an existing checklist; otherwise a new checklist is created with checklist_title.',
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
          let checklistId = args.checklist_id
          if (checklistId) {
            const lists = await services.cards.detail(actor, args.card_id)
            if (!lists.checklists.some((cl) => cl.id === checklistId)) {
              throw new AppError(404, 'not_found', 'Checklist not found on this card')
            }
          } else {
            const created = await services.cards.createChecklist(actor, args.card_id, { title: args.checklist_title ?? 'Checklist' })
            checklistId = created.id
          }
          const items = []
          for (const text of args.items) items.push(await services.cards.addItem(actor, checklistId, { text }))
          return { checklist_id: checklistId, items: items.map((i) => ({ id: i.id, text: i.text })) }
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
          content: z.string().max(200_000).optional(),
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
          'Updates a page title and/or Markdown content. mode "replace" overwrites the content (send base_version from read_page to avoid overwriting newer edits); mode "append" adds content at the end.',
        inputSchema: {
          page_id: uuid,
          title: z.string().max(200).optional(),
          content: z.string().max(200_000).optional(),
          mode: z.enum(['replace', 'append']).default('replace'),
          base_version: z.number().int().min(1).optional(),
        },
        annotations: WRITE,
      },
      ({ page_id, title, content, mode, base_version }) =>
        run(async () => {
          const result = await services.pages.update(
            actor,
            page_id,
            { title, content, baseVersion: base_version },
            { allowBlindWrite: true, append: mode === 'append' && content !== undefined },
          )
          return { updated: true, page_id: result.id, version: result.version }
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

  return server
}
