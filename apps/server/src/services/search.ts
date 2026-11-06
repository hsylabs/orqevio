import type { SearchResultDTO } from '@orqevio/shared'
import { markdownToPlainText } from '@orqevio/shared'
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import type { Actor } from '../auth/actor'
import { hasScope } from '../auth/actor'
import { boards, cards, columns, pages, projects } from '../db/schema'
import type { Access } from './access'
import type { Deps } from './deps'

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (m) => `\\${m}`)

function excerpt(text: string, query: string, size = 140) {
  const plain = markdownToPlainText(text)
  if (!plain) return ''
  const at = plain.toLowerCase().indexOf(query.toLowerCase())
  if (at < 0) return plain.slice(0, size)
  const start = Math.max(0, at - 40)
  return `${start > 0 ? '…' : ''}${plain.slice(start, start + size)}${start + size < plain.length ? '…' : ''}`
}

export class SearchService {
  constructor(
    private readonly deps: Deps,
    private readonly access: Access,
  ) {}

  /** Substring search over card and page titles/bodies, accelerated by trigram indexes. */
  async search(actor: Actor, workspaceId: string, rawQuery: string, opts: { types?: Array<'card' | 'page'>; limit?: number } = {}) {
    await this.access.workspace(actor, workspaceId)
    const query = rawQuery.trim().slice(0, 100)
    if (query.length === 0) return []
    const pattern = `%${escapeLike(query)}%`
    const limit = Math.min(opts.limit ?? 20, 50)
    const types = opts.types ?? ['card', 'page']
    const results: SearchResultDTO[] = []

    if (types.includes('card') && hasScope(actor, 'tasks:read')) {
      const rows = await this.deps.db
        .select({
          id: cards.id,
          title: cards.title,
          description: cards.description,
          boardId: boards.id,
          boardName: boards.name,
          columnName: columns.name,
          projectId: projects.id,
          projectName: projects.name,
          titleHit: sql<boolean>`${cards.title} ilike ${pattern}`,
        })
        .from(cards)
        .innerJoin(boards, eq(boards.id, cards.boardId))
        .innerJoin(columns, eq(columns.id, cards.columnId))
        .innerJoin(projects, eq(projects.id, boards.projectId))
        .where(and(eq(cards.workspaceId, workspaceId), isNull(cards.archivedAt), or(ilike(cards.title, pattern), ilike(cards.description, pattern))))
        .orderBy(desc(sql`${cards.title} ilike ${pattern}`), desc(cards.updatedAt))
        .limit(limit)
      for (const r of rows) {
        results.push({
          type: 'card',
          id: r.id,
          title: r.title,
          excerpt: r.titleHit ? markdownToPlainText(r.description).slice(0, 140) : excerpt(r.description, query),
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
      const rows = await this.deps.db
        .select({
          id: pages.id,
          title: pages.title,
          icon: pages.icon,
          content: pages.content,
          projectId: projects.id,
          projectName: projects.name,
          titleHit: sql<boolean>`${pages.title} ilike ${pattern}`,
        })
        .from(pages)
        .innerJoin(projects, eq(projects.id, pages.projectId))
        .where(and(eq(pages.workspaceId, workspaceId), or(ilike(pages.title, pattern), ilike(pages.content, pattern))))
        .orderBy(desc(sql`${pages.title} ilike ${pattern}`), desc(pages.updatedAt))
        .limit(limit)
      for (const r of rows) {
        results.push({
          type: 'page',
          id: r.id,
          title: r.title,
          excerpt: r.titleHit ? markdownToPlainText(r.content).slice(0, 140) : excerpt(r.content, query),
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
