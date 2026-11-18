import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate'
import { asc, eq } from 'drizzle-orm'
import type { Actor } from '../auth/actor'
import { attachments, boards, cardLabels, cardPageLinks, cards, checklistItems, checklists, columns, labels, pages, projects, workspaceMembers, workspaces } from '../db/schema'
import { VERSION } from '../version'
import type { Access } from './access'
import type { Deps } from './deps'

/** What the export holds, at its root (export.json). */
export const EXPORT_FORMAT = 'orqevio-export'

/** Characters no file system takes in a name, and the ones that hide or break it. */
const UNSAFE = /[\u0000-\u001f\u007f<>:"/\\|?*]/g

/** A name that every file system takes: no separators or reserved characters, not too long, never empty. */
export function safeName(name: string, fallback = 'Untitled') {
  const clean = name.replace(UNSAFE, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').replace(/[. ]+$/, '')
  return [...(clean || fallback)].slice(0, 80).join('')
}

/** Gives each name once within a folder: "Notes", "Notes (2)"… (compared without case, as on Windows and macOS). */
function namer() {
  const taken = new Set<string>()
  return (name: string, extension = '') => {
    let candidate = `${name}${extension}`
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${name} (${n})${extension}`
    taken.add(candidate.toLowerCase())
    return candidate
  }
}

const iso = (date: Date | null) => (date ? date.toISOString() : null)
/** Due dates are calendar days: the day, without the hour they are stored at. */
const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null)

interface FileEntry {
  path: string
  storageKey: string
  size: number
}

/**
 * The person's data as a ZIP to read or take elsewhere: for each workspace, its tasks in JSON,
 * its documents in Markdown with their tree as folders, and the attachments as files. Neither
 * the vault (it has its own encrypted export), the history nor the trash. The texts are read
 * in one synchronous pass, a consistent snapshot even on Cloudflare; the attachments follow,
 * streamed one by one, so memory stays flat whatever their size.
 */
export class ExportService {
  constructor(
    private readonly deps: Deps,
    private readonly access: Access,
  ) {}

  /** The ZIP as a stream, and the name to save it under. */
  async export(actor: Actor) {
    this.access.requireUser(actor)
    const now = new Date()
    const root = `orqevio-${now.toISOString().slice(0, 10)}`
    const { texts, files } = this.snapshot(actor.userId, root, now)

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
    const writer = writable.getWriter()
    let failed: unknown = null
    const zip = new Zip((error, chunk, final) => {
      if (error) {
        failed = error
        void writer.abort(error).catch(() => {})
        return
      }
      void writer.write(chunk).catch(() => {})
      if (final) void writer.close().catch(() => {})
    })
    const add = (entry: ZipDeflate, data: Uint8Array) => {
      zip.add(entry)
      entry.push(data, true)
    }

    void (async () => {
      try {
        for (const [path, text] of texts) add(new ZipDeflate(path, { level: 6 }), strToU8(text))
        for (const file of files) {
          const entry = new ZipPassThrough(file.path)
          zip.add(entry)
          const body = await this.deps.storage.stream(file.storageKey)
          if (body) {
            const reader = (body as ReadableStream<Uint8Array>).getReader()
            for (;;) {
              // Backpressure: the next piece of a file is read once the browser took the last one.
              await writer.ready
              const { value, done } = await reader.read()
              if (done) break
              if (failed) throw failed
              entry.push(value)
            }
          }
          entry.push(new Uint8Array(0), true)
        }
        zip.end()
      } catch (error) {
        console.error('[export] failed', error)
        await writer.abort(error).catch(() => {})
      }
    })()
    return { body: readable, filename: `${root}.zip` }
  }

  /** Every text of the export and the list of attachments to add, read at once from the database. */
  private snapshot(userId: string, root: string, now: Date) {
    const db = this.deps.db
    const texts: Array<[string, string]> = []
    const files: FileEntry[] = []
    const memberships = db
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, userId))
      .orderBy(asc(workspaces.createdAt))
      .all()
    const workspaceNames = namer()
    const summary: Array<{ name: string; folder: string }> = []

    for (const workspace of memberships) {
      const folder = workspaceNames(safeName(workspace.name))
      summary.push({ name: workspace.name, folder })
      const base = `${root}/${folder}`
      const projectRows = db.select().from(projects).where(eq(projects.workspaceId, workspace.id)).orderBy(asc(projects.position), asc(projects.id)).all()
      const boardRows = db.select().from(boards).where(eq(boards.workspaceId, workspace.id)).orderBy(asc(boards.position), asc(boards.id)).all()
      const columnRows = db.select().from(columns).where(eq(columns.workspaceId, workspace.id)).orderBy(asc(columns.position), asc(columns.id)).all()
      const cardRows = db.select().from(cards).where(eq(cards.workspaceId, workspace.id)).orderBy(asc(cards.position), asc(cards.id)).all()
      const labelRows = db.select().from(labels).where(eq(labels.workspaceId, workspace.id)).all()
      const checklistRows = db.select().from(checklists).where(eq(checklists.workspaceId, workspace.id)).orderBy(asc(checklists.position), asc(checklists.id)).all()
      const itemRows = db.select().from(checklistItems).where(eq(checklistItems.workspaceId, workspace.id)).orderBy(asc(checklistItems.position), asc(checklistItems.id)).all()
      const pageRows = db.select().from(pages).where(eq(pages.workspaceId, workspace.id)).orderBy(asc(pages.position), asc(pages.id)).all()
      const fileRows = db.select().from(attachments).where(eq(attachments.workspaceId, workspace.id)).orderBy(asc(attachments.createdAt), asc(attachments.id)).all()
      // Joined rather than listed by id: a Durable Object takes at most 100 bound values in a query.
      const cardLabelRows = db.select({ cardId: cardLabels.cardId, labelId: cardLabels.labelId }).from(cardLabels).innerJoin(cards, eq(cards.id, cardLabels.cardId)).where(eq(cards.workspaceId, workspace.id)).all()
      const linkRows = db.select({ cardId: cardPageLinks.cardId, pageId: cardPageLinks.pageId }).from(cardPageLinks).innerJoin(cards, eq(cards.id, cardPageLinks.cardId)).where(eq(cards.workspaceId, workspace.id)).all()
      const group = <T, K>(rows: T[], key: (row: T) => K) => {
        const groups = new Map<K, T[]>()
        for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row])
        return (k: K) => groups.get(k) ?? []
      }
      const cardById = new Map(cardRows.map((c) => [c.id, c]))
      const labelById = new Map(labelRows.map((l) => [l.id, l]))
      const boardsOf = group(boardRows, (b) => b.projectId)
      const labelsOf = group(labelRows, (l) => l.boardId)
      const columnsOf = group(columnRows, (c) => c.boardId)
      const cardsOf = group(cardRows, (c) => c.columnId)
      const labelsOfCard = group(cardLabelRows, (l) => l.cardId)
      const checklistsOf = group(checklistRows, (l) => l.cardId)
      const itemsOf = group(itemRows, (i) => i.checklistId)
      const linksOf = group(linkRows, (l) => l.cardId)
      const filesOf = group(fileRows, (f) => f.cardId)

      // Documents: each project a folder, each page a Markdown file, its subpages in a folder of the same name.
      const pagePath = new Map<string, string>()
      const projectFolders = namer()
      const projectFolder = new Map(projectRows.map((p) => [p.id, projectFolders(safeName(p.name))]))
      const byParent = new Map<string, typeof pageRows>()
      for (const page of pageRows) {
        const key = page.parentId ?? `project:${page.projectId}`
        byParent.set(key, [...(byParent.get(key) ?? []), page])
      }
      const placePages = (key: string, folder: string, depth: number) => {
        const names = namer()
        for (const page of byParent.get(key) ?? []) {
          const name = names(safeName(page.title), '.md')
          const path = `${folder}/${name}`
          pagePath.set(page.id, path)
          texts.push([`${base}/${path}`, page.content])
          if (depth < 200) placePages(page.id, `${folder}/${name.slice(0, -'.md'.length)}`, depth + 1)
        }
      }
      for (const project of projectRows) placePages(`project:${project.id}`, `documents/${projectFolder.get(project.id)}`, 0)

      // Attachments: next to what holds them, under attachments/ (a card) or next to the documents (a page).
      const filePath = new Map<string, string>()
      const fileFolders = new Map<string, ReturnType<typeof namer>>()
      const folderFor = (key: string) => {
        let names = fileFolders.get(key)
        if (!names) fileFolders.set(key, (names = namer()))
        return names
      }
      const cardFolder = new Map<string, string>()
      const cardFolderNames = namer()
      for (const file of fileRows) {
        let folder: string
        if (file.cardId) {
          let named = cardFolder.get(file.cardId)
          if (!named) {
            const card = cardById.get(file.cardId)
            named = `attachments/${cardFolderNames(safeName(card?.title ?? ''))}`
            cardFolder.set(file.cardId, named)
          }
          folder = named
        } else {
          const page = pagePath.get(file.pageId ?? '')
          folder = page ? `${page.slice(0, -'.md'.length)} (files)` : 'attachments/pages'
        }
        const dot = file.filename.lastIndexOf('.')
        const stem = dot > 0 ? file.filename.slice(0, dot) : file.filename
        const ending = dot > 0 ? safeName(file.filename.slice(dot + 1), '').slice(0, 15) : ''
        const path = `${folder}/${folderFor(folder)(safeName(stem, 'file'), ending ? `.${ending}` : '')}`
        filePath.set(file.id, path)
        files.push({ path: `${base}/${path}`, storageKey: file.storageKey, size: file.size })
      }

      // Tasks: projects, their boards, columns and cards, in order.
      const tasks = {
        workspace: workspace.name,
        projects: projectRows.map((project) => ({
          name: project.name,
          color: project.color,
          description: project.description,
          documents: `documents/${projectFolder.get(project.id)}`,
          boards: boardsOf(project.id).map((board) => ({
            name: board.name,
            labels: labelsOf(board.id).map((l) => ({ name: l.name, color: l.color })),
            columns: columnsOf(board.id).map((column) => ({
              name: column.name,
              cards: cardsOf(column.id).map((card) => ({
                title: card.title,
                description: card.description,
                labels: labelsOfCard(card.id)
                  .map((cl) => labelById.get(cl.labelId)?.name)
                  .filter(Boolean),
                due: day(card.dueAt),
                archived: card.archivedAt !== null,
                checklists: checklistsOf(card.id).map((list) => ({ title: list.title, items: itemsOf(list.id).map((i) => ({ text: i.text, done: i.done })) })),
                documents: linksOf(card.id)
                  .map((link) => pagePath.get(link.pageId))
                  .filter(Boolean),
                attachments: filesOf(card.id).map((f) => filePath.get(f.id)),
                createdAt: iso(card.createdAt),
                updatedAt: iso(card.updatedAt),
              })),
            })),
          })),
        })),
      }
      texts.push([`${base}/tasks.json`, `${JSON.stringify(tasks, null, 2)}\n`])
    }
    texts.unshift([
      `${root}/export.json`,
      `${JSON.stringify({ format: EXPORT_FORMAT, version: 1, app: VERSION, exportedAt: now.toISOString(), workspaces: summary }, null, 2)}\n`,
    ])
    return { texts, files }
  }
}
