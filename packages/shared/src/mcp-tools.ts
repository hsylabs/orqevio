/**
 * What an access needs to see a group of MCP tools, as the Agents page says it:
 * - `read` / `write`: reading / writing in tasks or in documents;
 * - `tasksRead`, `tasksWrite`, `docsRead`, `docsWrite`: in that area;
 * - `organize`: «can delete and move», on top of writing.
 */
export type McpToolNeed = 'read' | 'write' | 'tasksRead' | 'tasksWrite' | 'docsRead' | 'docsWrite' | 'organize'

/**
 * The MCP tools in the groups the Agents page shows, each with what it needs; `id` names the
 * group's description in the web app's catalog. A server test checks it against the tools the
 * MCP server registers, so a new tool can't be left out.
 */
export const MCP_TOOL_GROUPS = [
  { id: 'listProjects', tools: ['list_projects'], need: 'read' },
  { id: 'search', tools: ['search'], need: 'read' },
  { id: 'readAttachments', tools: ['read_attachment'], need: 'read' },
  { id: 'readBoards', tools: ['get_board', 'get_card', 'list_comments'], need: 'tasksRead' },
  { id: 'editCards', tools: ['create_card', 'update_card', 'move_card'], need: 'tasksWrite' },
  { id: 'archiveCard', tools: ['archive_card'], need: 'tasksWrite' },
  { id: 'comments', tools: ['add_comment', 'update_comment'], need: 'tasksWrite' },
  { id: 'organizeBoards', tools: ['create_board', 'create_column', 'update_column'], need: 'tasksWrite' },
  { id: 'labels', tools: ['create_label', 'create_checklist', 'add_checklist_items', 'update_checklist_item'], need: 'tasksWrite' },
  { id: 'readPages', tools: ['list_pages', 'read_page'], need: 'docsRead' },
  { id: 'writePages', tools: ['create_page', 'update_page'], need: 'docsWrite' },
  { id: 'movePage', tools: ['move_page'], need: 'docsWrite' },
  { id: 'uploadAttachment', tools: ['upload_attachment'], need: 'write' },
  { id: 'linkCard', tools: ['link_card_to_page'], need: 'write' },
  { id: 'createProject', tools: ['create_project'], need: 'write' },
  { id: 'deleteTasks', tools: ['delete_card', 'delete_board', 'delete_column', 'delete_label', 'delete_checklist', 'delete_checklist_item', 'delete_comment'], need: 'organize' },
  { id: 'deleteDocs', tools: ['delete_page', 'delete_project', 'delete_attachment'], need: 'organize' },
  { id: 'moveElsewhere', tools: ['move_attachment', 'unlink_card_from_page'], need: 'organize' },
] as const satisfies ReadonlyArray<{ id: string; tools: readonly string[]; need: McpToolNeed }>
