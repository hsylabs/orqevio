import type { SearchResultDTO } from '@orqevio/shared'
import { markdownToPlainText } from '@orqevio/shared'
import { sql } from 'drizzle-orm'
import type { Actor } from '../auth/actor'
import { hasScope } from '../auth/actor'
import type { Access } from './access'
import type { Deps } from './deps'

/** Lowercase, without accents: the same folding the FTS5 tokenizer applies. */
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Words of the query that can be searched (at least one letter or digit). */
export function searchTerms(raw: string) {
  return raw
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ''))
    .filter((t) => /[\p{L}\p{N}]/u.test(t))
    .slice(0, 8)
}

/** FTS5 query: every word must match the start of a word ("diseñ" finds "Diseño"). */
export const ftsQuery = (terms: string[]) => terms.map((t) => `"${t}"*`).join(' ')

function excerpt(text: string, terms: string[], size = 140) {
  const plain = markdownToPlainText(text)
  if (!plain) return ''
  const folded = fold(plain)
  const at = Math.min(...terms.map((t) => folded.indexOf(fold(t))).filter((i) => i >= 0))
  if (!Number.isFinite(at)) return plain.slice(0, size)
  const start = Math.max(0, at - 40)
  return `${start > 0 ? '…' : ''}${plain.slice(start, start + size)}${start + size < plain.length ? '…' : ''}`
}

const titleHit = (title: string, terms: string[]) => terms.some((t) => fold(title).includes(fold(t)))

export class SearchService {
  constructor(
    private readonly deps: Deps,
    private readonly access: Access,
  ) {}

  /** Full-text search over card and page titles and bodies (FTS5), titles ranked first. */
  async search(actor: Actor, workspaceId: string, rawQuery: string, opts: { types?: Array<'card' | 'page'>; limit?: number } = {}) {
    await this.access.workspace(actor, workspaceId)
    const terms = searchTerms(rawQuery.trim().slice(0, 100))
    if (terms.length === 0) return []
    const match = ftsQuery(terms)
    // Results whose title alone matches every word come first, whatever BM25 says about long bodies.
    const titleMatch = `title : (${match})`
    const limit = Math.min(opts.limit ?? 20, 50)
    const types = opts.types ?? ['card', 'page']
    const results: SearchResultDTO[] = []

    if (types.includes('card') && hasScope(actor, 'tasks:read')) {
      const rows = this.deps.db.all<{
        id: string
        title: string
        description: string
        boardId: string
        boardName: string
        columnName: string
        projectId: string
        projectName: string
      }>(sql`
        SELECT c.id, c.title, c.description, b.id AS boardId, b.name AS boardName, col.name AS columnName,
               p.id AS projectId, p.name AS projectName
        FROM cards_fts
        JOIN cards_fts_map m ON m.id = cards_fts.rowid
        JOIN cards c ON c.id = m.entity_id
        JOIN boards b ON b.id = c.board_id
        JOIN board_columns col ON col.id = c.column_id
        JOIN projects p ON p.id = b.project_id
        WHERE cards_fts MATCH ${match} AND c.workspace_id = ${workspaceId} AND c.archived_at IS NULL
        ORDER BY cards_fts.rowid NOT IN (SELECT rowid FROM cards_fts WHERE cards_fts MATCH ${titleMatch}),
                 bm25(cards_fts, 10, 1), c.updated_at DESC
        LIMIT ${limit}`)
      for (const r of rows) {
        results.push({
          type: 'card',
          id: r.id,
          title: r.title,
          excerpt: titleHit(r.title, terms) ? markdownToPlainText(r.description).slice(0, 140) : excerpt(r.description, terms),
          icon: null,
          projectId: r.projectId,
          projectName: r.projectName,
          boardId: r.boardId,
          boardName: r.boardName,
          columnName: r.columnName,
        })
      }
    }

    if (types.includes('page') && hasScope(actor, 'docs:read')) {
      const rows = this.deps.db.all<{ id: string; title: string; icon: string | null; content: string; projectId: string; projectName: string }>(sql`
        SELECT pg.id, pg.title, pg.icon, pg.content, p.id AS projectId, p.name AS projectName
        FROM pages_fts
        JOIN pages_fts_map m ON m.id = pages_fts.rowid
        JOIN pages pg ON pg.id = m.entity_id
        JOIN projects p ON p.id = pg.project_id
        WHERE pages_fts MATCH ${match} AND pg.workspace_id = ${workspaceId}
        ORDER BY pages_fts.rowid NOT IN (SELECT rowid FROM pages_fts WHERE pages_fts MATCH ${titleMatch}),
                 bm25(pages_fts, 10, 1), pg.updated_at DESC
        LIMIT ${limit}`)
      for (const r of rows) {
        results.push({
          type: 'page',
          id: r.id,
          title: r.title,
          excerpt: titleHit(r.title, terms) ? markdownToPlainText(r.content).slice(0, 140) : excerpt(r.content, terms),
          icon: r.icon,
          projectId: r.projectId,
          projectName: r.projectName,
          boardId: null,
          boardName: null,
          columnName: null,
        })
      }
    }
    return results
  }
}
