import type { ActorRef, LinkedCardDTO, PageDTO, PageNodeDTO, PaletteColor } from '@orqevio/shared'
import { extractReferences, pageCreateInput, pageMoveInput, pageUpdateInput } from '@orqevio/shared'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Actor } from '../auth/actor'
import { hasScope } from '../auth/actor'
import type { DbOrTx } from '../db/client'
import { apiTokens, attachments, boards, cardPageLinks, cards, columns, pages, projects, users } from '../db/schema'
import { badRequest, conflict, notFound } from '../lib/errors'
import { parse } from '../lib/validate'
import type { Access } from './access'
import type { ActivityService } from './activity'
import { toAttachmentDTO } from './attachments'
import type { Deps } from './deps'
import { positionAt } from './ordering'

type PageRow = typeof pages.$inferSelect

const toNode = (p: Pick<PageRow, 'id' | 'projectId' | 'parentId' | 'title' | 'icon' | 'position' | 'updatedAt'>): PageNodeDTO => ({
  id: p.id,
  projectId: p.projectId,
  parentId: p.parentId,
  title: p.title,
  icon: p.icon,
  position: p.position,
  updatedAt: p.updatedAt.toISOString(),
})

const siblingsOf = (projectId: string, parentId: string | null) =>
  and(eq(pages.projectId, projectId), parentId ? eq(pages.parentId, parentId) : isNull(pages.parentId))

export class PageService {
  constructor(
    private readonly deps: Deps,
    private readonly access: Access,
    private readonly activity: ActivityService,
  ) {}

  async load(actor: Actor, pageId: string, scope: 'docs:read' | 'docs:write' = 'docs:read', db: DbOrTx = this.deps.db) {
    this.access.requireScope(actor, scope)
    const [page] = await db.select().from(pages).where(eq(pages.id, pageId))
    if (!page) throw notFound('Page')
    await this.access.workspace(actor, page.workspaceId)
    return page
  }

  async tree(actor: Actor, projectId: string): Promise<PageNodeDTO[]> {
    this.access.requireScope(actor, 'docs:read')
    const project = await this.project(actor, projectId)
    const rows = await this.deps.db
      .select()
      .from(pages)
      .where(eq(pages.projectId, project.id))
      .orderBy(asc(pages.position), asc(pages.id))
    return rows.map(toNode)
  }

  private async project(actor: Actor, projectId: string) {
    const [project] = await this.deps.db.select().from(projects).where(eq(projects.id, projectId))
    if (!project) throw notFound('Project')
    await this.access.workspace(actor, project.workspaceId)
    return project
  }

  async create(actor: Actor, projectId: string, input: unknown): Promise<PageNodeDTO> {
    this.access.requireScope(actor, 'docs:write')
    const data = parse(pageCreateInput, input)
    const project = await this.project(actor, projectId)
    if (data.parentId) {
      const parent = await this.load(actor, data.parentId)
      if (parent.projectId !== projectId) throw badRequest('The parent page belongs to another project')
    }
    const page = await this.deps.db.transaction(async (tx) => {
      const position = await positionAt(tx, pages, siblingsOf(projectId, data.parentId ?? null), undefined)
      const [row] = await tx
        .insert(pages)
        .values({
          workspaceId: project.workspaceId,
          projectId,
          parentId: data.parentId ?? null,
          title: data.title,
          icon: data.icon ?? null,
          content: data.content,
          position,
          createdByUserId: actor.userId,
          createdByTokenId: actor.kind === 'agent' ? actor.tokenId : null,
          updatedByUserId: actor.userId,
          updatedByTokenId: actor.kind === 'agent' ? actor.tokenId : null,
        })
        .returning()
      if (data.content) await this.syncMentions(tx, row!)
      return row!
    })
    await this.activity.record(
      actor,
      page.workspaceId,
      { action: 'page.created', entityType: 'page', entityId: page.id, summary: page.title || 'Sin título' },
      { pageId: page.id, projectId, version: page.version, structure: true },
    )
    return toNode(page)
  }

  async get(actor: Actor, pageId: string): Promise<PageDTO> {
    const page = await this.load(actor, pageId)
    const db = this.deps.db
    const [[project], children, linkRows, files, updatedBy, breadcrumbs] = await Promise.all([
      db.select({ id: projects.id, name: projects.name, color: projects.color }).from(projects).where(eq(projects.id, page.projectId)),
      db.select().from(pages).where(eq(pages.parentId, pageId)).orderBy(asc(pages.position), asc(pages.id)),
      hasScope(actor, 'tasks:read')
        ? db
            .select({
              id: cards.id,
              title: cards.title,
              boardId: cards.boardId,
              boardName: boards.name,
              columnName: columns.name,
              dueAt: cards.dueAt,
              archivedAt: cards.archivedAt,
              source: cardPageLinks.source,
            })
            .from(cardPageLinks)
            .innerJoin(cards, eq(cards.id, cardPageLinks.cardId))
            .innerJoin(boards, eq(boards.id, cards.boardId))
            .innerJoin(columns, eq(columns.id, cards.columnId))
            .where(eq(cardPageLinks.pageId, pageId))
            .orderBy(asc(cardPageLinks.createdAt))
        : [],
      db.select().from(attachments).where(eq(attachments.pageId, pageId)).orderBy(asc(attachments.createdAt)),
      this.updatedBy(page),
      this.breadcrumbs(page),
    ])
    const linked = new Map<string, LinkedCardDTO>()
    for (const r of linkRows) {
      const existing = linked.get(r.id)
      if (existing) existing.sources.push(r.source)
      else
        linked.set(r.id, {
          id: r.id,
          title: r.title,
          boardId: r.boardId,
          boardName: r.boardName,
          columnName: r.columnName,
          dueAt: r.dueAt?.toISOString() ?? null,
          archived: r.archivedAt !== null,
          sources: [r.source],
        })
    }
    return {
      id: page.id,
      projectId: page.projectId,
      workspaceId: page.workspaceId,
      parentId: page.parentId,
      title: page.title,
      icon: page.icon,
      content: page.content,
      version: page.version,
      createdAt: page.createdAt.toISOString(),
      updatedAt: page.updatedAt.toISOString(),
      updatedBy,
      project: { id: project!.id, name: project!.name, color: project!.color as PaletteColor },
      breadcrumbs,
      children: children.map(toNode),
      cards: [...linked.values()],
      attachments: files.map(toAttachmentDTO),
    }
  }

  private async updatedBy(page: PageRow): Promise<ActorRef | null> {
    if (page.updatedByTokenId) {
      const [t] = await this.deps.db.select({ id: apiTokens.id, name: apiTokens.name }).from(apiTokens).where(eq(apiTokens.id, page.updatedByTokenId))
      return t ? { kind: 'agent', id: t.id, name: t.name } : null
    }
    if (page.updatedByUserId) {
      const [u] = await this.deps.db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, page.updatedByUserId))
      return u ? { kind: 'user', id: u.id, name: u.name } : null
    }
    return null
  }

  private async breadcrumbs(page: PageRow) {
    if (!page.parentId) return []
    const rows = await this.deps.db.execute<{ id: string; title: string; icon: string | null; depth: number }>(sql`
      WITH RECURSIVE chain AS (
        SELECT id, parent_id, title, icon, 1 AS depth FROM pages WHERE id = ${page.parentId}
        UNION ALL
        SELECT p.id, p.parent_id, p.title, p.icon, c.depth + 1 FROM pages p JOIN chain c ON p.id = c.parent_id WHERE c.depth < 32
      )
      SELECT id, title, icon, depth FROM chain ORDER BY depth DESC`)
    return rows.rows.map((r) => ({ id: r.id, title: r.title, icon: r.icon }))
  }

  /**
   * Updates a page. Content writes require `baseVersion` unless the caller
   * explicitly opts into last-write-wins (agents that did not send a version).
   */
  async update(actor: Actor, pageId: string, input: unknown, opts: { allowBlindWrite?: boolean; append?: boolean } = {}) {
    const data = parse(pageUpdateInput, input)
    const current = await this.load(actor, pageId, 'docs:write')
    if (data.content !== undefined && data.baseVersion === undefined && !opts.allowBlindWrite && !opts.append) {
      throw badRequest('baseVersion is required when updating content')
    }
    const page = await this.deps.db.transaction(async (tx) => {
      // `version` tracks the body only, so renaming a page never conflicts with someone editing it.
      const patch: Record<string, unknown> = {
        updatedAt: new Date(),
        updatedByUserId: actor.userId,
        updatedByTokenId: actor.kind === 'agent' ? actor.tokenId : null,
      }
      if (data.content !== undefined) patch.version = sql`${pages.version} + 1`
      if (data.title !== undefined) patch.title = data.title
      if (data.icon !== undefined) patch.icon = data.icon
      if (data.content !== undefined) {
        patch.content = opts.append
          ? sql`CASE WHEN ${pages.content} = '' THEN ${data.content} ELSE ${pages.content} || E'\n\n' || ${data.content} END`
          : data.content
      }
      const guard =
        data.baseVersion !== undefined ? and(eq(pages.id, pageId), eq(pages.version, data.baseVersion)) : eq(pages.id, pageId)
      const [row] = await tx.update(pages).set(patch).where(guard).returning()
      if (!row) {
        const [latest] = await tx.select({ version: pages.version }).from(pages).where(eq(pages.id, pageId))
        throw conflict('This page was modified since you loaded it', { currentVersion: latest?.version ?? null })
      }
      if (data.content !== undefined) await this.syncMentions(tx, row)
      return row
    })
    const structural = (data.title !== undefined && data.title !== current.title) || (data.icon !== undefined && data.icon !== current.icon)
    await this.activity.record(
      actor,
      page.workspaceId,
      { action: 'page.updated', entityType: 'page', entityId: pageId, summary: page.title || 'Sin título', coalesce: true },
      { pageId, projectId: page.projectId, version: page.version, structure: structural },
    )
    return { id: page.id, version: page.version, title: page.title, icon: page.icon, updatedAt: page.updatedAt.toISOString() }
  }

  async move(actor: Actor, pageId: string, input: unknown) {
    const { parentId, index } = parse(pageMoveInput, input)
    const page = await this.load(actor, pageId, 'docs:write')
    if (parentId) {
      const parent = await this.load(actor, parentId)
      if (parent.projectId !== page.projectId) throw badRequest('Pages can only be moved within their project')
      // Reject cycles: the new parent cannot be the page itself or one of its descendants.
      const descendants = await this.deps.db.execute<{ id: string }>(sql`
        WITH RECURSIVE sub AS (
          SELECT id FROM pages WHERE id = ${pageId}
          UNION ALL SELECT p.id FROM pages p JOIN sub s ON p.parent_id = s.id
        ) SELECT id FROM sub`)
      if (descendants.rows.some((r) => r.id === parentId)) throw badRequest('A page cannot be moved inside itself')
    }
    const position = await positionAt(this.deps.db, pages, siblingsOf(page.projectId, parentId), index, pageId)
    await this.deps.db.update(pages).set({ parentId, position }).where(eq(pages.id, pageId))
    await this.activity.record(
      actor,
      page.workspaceId,
      { action: 'page.moved', entityType: 'page', entityId: pageId, summary: page.title || 'Sin título' },
      { pageId, projectId: page.projectId, structure: true },
    )
  }

  async remove(actor: Actor, pageId: string) {
    this.access.requireUser(actor)
    const page = await this.load(actor, pageId, 'docs:write')
    await this.deps.db.delete(pages).where(eq(pages.id, pageId))
    await this.activity.record(
      actor,
      page.workspaceId,
      { action: 'page.deleted', entityType: 'page', entityId: pageId, summary: page.title || 'Sin título' },
      { pageId, projectId: page.projectId, structure: true },
    )
  }

  /** Keeps `mention` links in sync with the card references found in the page body. */
  private async syncMentions(db: DbOrTx, page: PageRow) {
    const { cards: referenced } = extractReferences(page.content)
    await db.delete(cardPageLinks).where(and(eq(cardPageLinks.pageId, page.id), eq(cardPageLinks.source, 'mention')))
    if (referenced.length === 0) return
    const valid = await db
      .select({ id: cards.id })
      .from(cards)
      .where(and(inArray(cards.id, referenced.slice(0, 200)), eq(cards.workspaceId, page.workspaceId)))
    if (valid.length === 0) return
    await db
      .insert(cardPageLinks)
      .values(valid.map((c) => ({ cardId: c.id, pageId: page.id, workspaceId: page.workspaceId, source: 'mention' as const })))
      .onConflictDoNothing()
  }
}
