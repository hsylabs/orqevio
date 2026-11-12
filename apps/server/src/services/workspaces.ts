import type { HomeDTO, OverviewDTO, PaletteColor, WorkspaceDTO } from '@orqevio/shared'
import { projectCreateInput, projectUpdateInput, workspaceInput } from '@orqevio/shared'
import { and, asc, count, desc, eq, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import type { Actor } from '../auth/actor'
import { actorRef, hasScope } from '../auth/actor'
import { boards, cards, columns, pages, projects, workspaceMembers, workspaces } from '../db/schema'
import { forbidden, notFound } from '../lib/errors'
import { parse } from '../lib/validate'
import type { Access } from './access'
import type { ActivityService } from './activity'
import type { CardService } from './cards'
import type { Deps } from './deps'
import { positionAt } from './ordering'

const toWorkspaceDTO = (w: typeof workspaces.$inferSelect, role: 'owner' | 'editor'): WorkspaceDTO => ({
  id: w.id,
  name: w.name,
  role,
  createdAt: w.createdAt.toISOString(),
})

export const toProjectDTO = (p: typeof projects.$inferSelect) => ({
  id: p.id,
  workspaceId: p.workspaceId,
  name: p.name,
  color: p.color as PaletteColor,
  description: p.description,
  position: p.position,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
})

export class WorkspaceService {
  constructor(
    private readonly deps: Deps,
    private readonly access: Access,
    private readonly activity: ActivityService,
    private readonly cards: CardService,
  ) {}

  async list(actor: Actor): Promise<WorkspaceDTO[]> {
    const rows = await this.deps.db
      .select({ w: workspaces, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(
        and(
          eq(workspaceMembers.userId, actor.userId),
          actor.kind === 'agent' ? eq(workspaces.id, actor.workspaceId) : undefined,
        ),
      )
      .orderBy(asc(workspaces.createdAt))
    return rows.map((r) => toWorkspaceDTO(r.w, r.role))
  }

  async create(actor: Actor, input: unknown): Promise<WorkspaceDTO> {
    this.access.requireUser(actor)
    const { name } = parse(workspaceInput, input)
    return this.deps.db.transaction((tx) => {
      const w = tx.insert(workspaces).values({ name }).returning().get()
      tx.insert(workspaceMembers).values({ workspaceId: w.id, userId: actor.userId, role: 'owner' }).run()
      return toWorkspaceDTO(w, 'owner')
    })
  }

  async update(actor: Actor, workspaceId: string, input: unknown): Promise<WorkspaceDTO> {
    this.access.requireUser(actor)
    const role = await this.access.workspace(actor, workspaceId)
    const { name } = parse(workspaceInput, input)
    const [w] = await this.deps.db
      .update(workspaces)
      .set({ name, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId))
      .returning()
    await this.activity.emit(workspaceId, { action: 'workspace.updated', actor: actorRef(actor), structure: true })
    return toWorkspaceDTO(w!, role)
  }

  async remove(actor: Actor, workspaceId: string) {
    this.access.requireUser(actor)
    const role = await this.access.workspace(actor, workspaceId)
    if (role !== 'owner') throw forbidden('Only the owner can delete this workspace')
    const [{ total }] = (await this.deps.db
      .select({ total: count() })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, actor.userId))) as [{ total: number }]
    if (total <= 1) throw forbidden('You need at least one workspace', 'last_workspace')
    await this.deps.db.delete(workspaces).where(eq(workspaces.id, workspaceId))
    await this.deps.storage.deleteWorkspace(workspaceId)
  }

  /** Sidebar tree: projects with their boards and page outline, filtered by scope. */
  async overview(actor: Actor, workspaceId: string): Promise<OverviewDTO> {
    const role = await this.access.workspace(actor, workspaceId)
    const db = this.deps.db
    const [w] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
    if (!w) throw notFound('Workspace')
    const projectRows = await db
      .select()
      .from(projects)
      .where(eq(projects.workspaceId, workspaceId))
      .orderBy(asc(projects.position), asc(projects.id))

    const canTasks = hasScope(actor, 'tasks:read')
    const canDocs = hasScope(actor, 'docs:read')

    const boardRows = canTasks
      ? await db
          .select({
            id: boards.id,
            projectId: boards.projectId,
            name: boards.name,
            position: boards.position,
            cardCount: sql<number>`(select count(*) from ${cards} where ${cards.boardId} = ${boards.id} and ${cards.archivedAt} is null)`,
          })
          .from(boards)
          .where(eq(boards.workspaceId, workspaceId))
          .orderBy(asc(boards.position), asc(boards.id))
      : []
    const pageRows = canDocs
      ? await db
          .select({
            id: pages.id,
            projectId: pages.projectId,
            parentId: pages.parentId,
            title: pages.title,
            icon: pages.icon,
            position: pages.position,
            updatedAt: pages.updatedAt,
          })
          .from(pages)
          .where(eq(pages.workspaceId, workspaceId))
          .orderBy(asc(pages.position), asc(pages.id))
      : []

    return {
      workspace: toWorkspaceDTO(w, role),
      projects: projectRows.map((p) => ({
        ...toProjectDTO(p),
        boards: boardRows.filter((b) => b.projectId === p.id),
        pages: pageRows
          .filter((pg) => pg.projectId === p.id)
          .map((pg) => ({ ...pg, updatedAt: pg.updatedAt.toISOString() })),
      })),
    }
  }

  async home(actor: Actor, workspaceId: string): Promise<HomeDTO> {
    await this.access.workspace(actor, workspaceId)
    this.access.requireUser(actor)
    const db = this.deps.db
    const horizon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const dueRows = await db
      .select({ card: cards, boardName: boards.name, columnName: columns.name, projectId: projects.id, projectName: projects.name })
      .from(cards)
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .innerJoin(columns, eq(columns.id, cards.columnId))
      .innerJoin(projects, eq(projects.id, boards.projectId))
      .where(and(eq(cards.workspaceId, workspaceId), isNull(cards.archivedAt), isNotNull(cards.dueAt), lte(cards.dueAt, horizon)))
      .orderBy(asc(cards.dueAt))
      .limit(12)
    const summaries = await this.cards.summarize(dueRows.map((r) => r.card))
    const recent = await db
      .select({
        id: pages.id,
        projectId: pages.projectId,
        parentId: pages.parentId,
        title: pages.title,
        icon: pages.icon,
        position: pages.position,
        updatedAt: pages.updatedAt,
        projectName: projects.name,
      })
      .from(pages)
      .innerJoin(projects, eq(projects.id, pages.projectId))
      .where(eq(pages.workspaceId, workspaceId))
      .orderBy(desc(pages.updatedAt))
      .limit(6)
    return {
      dueCards: dueRows.map((r, i) => ({
        ...summaries[i]!,
        boardName: r.boardName,
        columnName: r.columnName,
        projectId: r.projectId,
        projectName: r.projectName,
      })),
      recentPages: recent.map((p) => ({ ...p, updatedAt: p.updatedAt.toISOString() })),
      activity: await this.activity.list(workspaceId, { limit: 12 }),
    }
  }

  // ── Projects ──────────────────────────────────────────────────
  async getProject(actor: Actor, projectId: string) {
    const [p] = await this.deps.db.select().from(projects).where(eq(projects.id, projectId))
    if (!p) throw notFound('Project')
    await this.access.workspace(actor, p.workspaceId)
    return p
  }

  async createProject(actor: Actor, workspaceId: string, input: unknown) {
    this.access.requireUser(actor)
    await this.access.workspace(actor, workspaceId)
    const data = parse(projectCreateInput, input)
    const project = this.deps.db.transaction((tx) => {
      const position = positionAt(tx, projects, eq(projects.workspaceId, workspaceId), undefined)
      return tx
        .insert(projects)
        .values({ workspaceId, name: data.name, color: data.color, description: data.description ?? null, position })
        .returning()
        .get()
    })
    await this.activity.record(
      actor,
      workspaceId,
      { action: 'project.created', entityType: 'project', entityId: project.id, summary: project.name },
      { projectId: project.id, structure: true },
    )
    return toProjectDTO(project)
  }

  async updateProject(actor: Actor, projectId: string, input: unknown) {
    this.access.requireUser(actor)
    const current = await this.getProject(actor, projectId)
    const data = parse(projectUpdateInput, input)
    const [p] = await this.deps.db
      .update(projects)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(projects.id, projectId))
      .returning()
    await this.activity.record(
      actor,
      current.workspaceId,
      { action: 'project.updated', entityType: 'project', entityId: projectId, summary: p!.name },
      { projectId, structure: true },
    )
    return toProjectDTO(p!)
  }

  async removeProject(actor: Actor, projectId: string) {
    this.access.requireUser(actor)
    const current = await this.getProject(actor, projectId)
    await this.deps.db.delete(projects).where(eq(projects.id, projectId))
    await this.activity.record(
      actor,
      current.workspaceId,
      { action: 'project.deleted', entityType: 'project', entityId: projectId, summary: current.name },
      { projectId, structure: true },
    )
  }
}
