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

/**
 * Most file systems take names of up to 255 bytes. A name is cut well before, by its bytes in UTF-8
 * (an emoji takes 4), to leave room for " (2)", " (files)" and an extension.
 */
const NAME_BYTES = 150
const utf8 = new TextEncoder()

/** Names Windows keeps for devices, even with an extension after them (NUL.txt, con.tar.gz). */
const DEVICE = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(?=\.|$)/i

function cleanName(name: string, maxBytes: number) {
  const clean = name.replace(UNSAFE, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').replace(/[. ]+$/, '')
  let cut = ''
  let bytes = 0
  for (const char of clean) {
    bytes += utf8.encode(char).length
    if (bytes > maxBytes) break
    cut += char
  }
  return cut.replace(/[. ]+$/, '')
}

/**
 * A name that every file system takes: no separators or reserved characters, none of the names
 * Windows keeps for devices ("CON" becomes "CON_"), not too long, never empty.
 */
export function safeName(name: string, fallback = 'Untitled', maxBytes = NAME_BYTES) {
  return cleanName(name, maxBytes).replace(DEVICE, '$&_') || fallback
}

/**
 * Gives each name once within a folder: "Notes", "Notes (2)"… (compared without case, as on Windows
 * and macOS). A name can take several entries at once: a page takes "Notes.md" for its text and
 * "Notes" for the folder of its subpages, and its attachments go in "Notes (files)". All of them
 * go through the same namer, so that no file and no folder takes another's name.
 */
function namer(reserved: string[] = []) {
  const taken = new Set(reserved.map((name) => name.toLowerCase()))
  const free = (stem: string, endings: string[]) => endings.every((ending) => !taken.has(`${stem}${ending}`.toLowerCase()))
  /** The first free stem for every one of `endings` (just the name, by default), which it then takes. */
  return (name: string, endings = ['']) => {
    let stem = name
    for (let n = 2; !free(stem, endings); n++) stem = `${name} (${n})`
    for (const ending of endings) taken.add(`${stem}${ending}`.toLowerCase())
    return stem
  }
}

/** A path inside the ZIP as a Markdown link from `fromDir`: relative, each part encoded (spaces, parentheses). */
function linkTo(fromDir: string, target: string) {
  const from = fromDir ? fromDir.split('/') : []
  const to = target.split('/')
  let common = 0
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++
  const parts = [...from.slice(common).map(() => '..'), ...to.slice(common)]
  return parts.map((part) => (part === '..' ? part : encodeURIComponent(part).replace(/\(/g, '%28').replace(/\)/g, '%29'))).join('/')
}

/**
 * Where a link's destination starts: after "](" in a link or image, after "[name]:" in a link
 * definition, or in an HTML src or href attribute. A URL anywhere else is text, kept as it is.
 */
const DESTINATION = String.raw`(\]\(\s*<?|^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*<?|\b(?:src|href)=["']?)`
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
/** Links to attachments, as the editor writes them: /api/attachments/<id>, or with the copy's address in front. */
const ATTACHMENT_LINK = new RegExp(String.raw`${DESTINATION}(?:https?:\/\/[^\s()<>"']+)?\/api\/attachments\/(${UUID})(?=[\s)>"'])`, 'gim')
/** References to documents and tasks, as the editor writes them: [Title](/doc/<id>), [Title](/card/<id>) (see links.ts in @orqevio/shared). */
const REFERENCE = new RegExp(String.raw`${DESTINATION}\/(doc|card)\/(${UUID})(?=[\s)>"'])`, 'gim')

/** A fence that opens or closes a code block, also inside a quote or a list item. */
const FENCE = /^[ \t]*(?:>[ \t]?)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/

/**
 * Applies `change` to a Markdown text but not to its code, fenced blocks and inline spans, which
 * are kept exactly as they are: a link written in an example is part of the example.
 */
export function outsideCode(markdown: string, change: (text: string) => string) {
  const out: string[] = []
  let text = ''
  const flush = () => {
    if (text) out.push(outsideInlineCode(text, change))
    text = ''
  }
  let fence: { char: string; size: number } | null = null
  for (const line of markdown.split(/(?<=\n)/)) {
    const match = FENCE.exec(line.replace(/\r?\n$/, ''))
    if (fence) {
      out.push(line)
      if (match && match[1]![0] === fence.char && match[1]!.length >= fence.size && !match[2]!.trim()) fence = null
    } else if (match && !(match[1]![0] === '`' && match[2]!.includes('`'))) {
      flush()
      out.push(line)
      fence = { char: match[1]![0]!, size: match[1]!.length }
    } else {
      text += line
    }
  }
  flush()
  return out.join('')
}

/** A run of backticks opens a code span that the next run of as many closes, within the same paragraph. */
function outsideInlineCode(text: string, change: (text: string) => string) {
  const parts: string[] = []
  let last = 0
  const runs = /`+/g
  for (let open = runs.exec(text); open; open = runs.exec(text)) {
    if (text[open.index - 1] === '\\') continue
    const ticks = open[0]
    const closing = new RegExp(`(?<!\`)${ticks}(?!\`)`, 'g')
    closing.lastIndex = open.index + ticks.length
    const close = closing.exec(text)
    if (!close || /\n[ \t]*\n/.test(text.slice(open.index, close.index))) continue
    parts.push(change(text.slice(last, open.index)), text.slice(open.index, close.index + ticks.length))
    last = close.index + ticks.length
    runs.lastIndex = last
  }
  parts.push(change(text.slice(last)))
  return parts.join('')
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
    const { texts, files, summary } = this.snapshot(actor.userId, root)

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
        // An attachment whose file is gone from storage (a backup restored without it, say) is listed, never an empty file.
        const missing = new Set<string>()
        for (const file of files) if (!(await this.deps.storage.exists(file.storageKey))) missing.add(file.path)
        const about = { format: EXPORT_FORMAT, version: 1, app: VERSION, exportedAt: now.toISOString(), workspaces: summary, missingAttachments: [...missing].map((path) => path.slice(root.length + 1)) }
        add(new ZipDeflate(`${root}/export.json`, { level: 6 }), strToU8(`${JSON.stringify(about, null, 2)}\n`))
        for (const [path, text] of texts) add(new ZipDeflate(path, { level: 6 }), strToU8(text))
        for (const file of files) {
          const body = missing.has(file.path) ? null : await this.deps.storage.stream(file.storageKey)
          if (!body) continue
          const entry = new ZipPassThrough(file.path)
          zip.add(entry)
          const reader = (body as ReadableStream<Uint8Array>).getReader()
          for (;;) {
            // Backpressure: the next piece of a file is read once the browser took the last one.
            await writer.ready
            const { value, done } = await reader.read()
            if (done) break
            if (failed) throw failed
            entry.push(value)
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
  private snapshot(userId: string, root: string) {
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
    // export.json is at the root, next to the workspaces' folders.
    const workspaceNames = namer(['export.json'])
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
        for (const row of rows) {
          const bucket = groups.get(key(row))
          if (bucket) bucket.push(row)
          else groups.set(key(row), [row])
        }
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

      // Documents: each project a folder, each page a Markdown file, its subpages in a folder of the
      // same name, its attachments in "<name> (files)". Walked without recursion: a tree has no depth limit.
      const pagePath = new Map<string, string>()
      const pageFilesFolder = new Map<string, string>()
      const projectFolders = namer()
      const projectFolder = new Map(projectRows.map((p) => [p.id, projectFolders(safeName(p.name))]))
      const byParent = group(pageRows, (page) => page.parentId ?? `project:${page.projectId}`)
      const withFiles = new Set(fileRows.map((f) => f.pageId).filter((id): id is string => Boolean(id)))
      const folderNames = new Map<string, ReturnType<typeof namer>>()
      const namesIn = (folder: string) => {
        let names = folderNames.get(folder)
        if (!names) folderNames.set(folder, (names = namer()))
        return names
      }
      const place = (page: (typeof pageRows)[number], folder: string) => {
        const names = namesIn(folder)
        // Its text and the folder of its subpages: "A.md" and "A", both free (a sibling "A.md" would take "A.md" as a folder).
        const stem = names(safeName(page.title), ['.md', ''])
        pagePath.set(page.id, `${folder}/${stem}.md`)
        if (withFiles.has(page.id)) pageFilesFolder.set(page.id, `${folder}/${names(`${stem} (files)`)}`)
        return `${folder}/${stem}`
      }
      const pending: Array<{ key: string; folder: string }> = projectRows.map((p) => ({ key: `project:${p.id}`, folder: `documents/${projectFolder.get(p.id)}` }))
      while (pending.length) {
        const { key, folder } = pending.pop()!
        for (const page of byParent(key)) {
          if (pagePath.has(page.id)) continue
          pending.push({ key: page.id, folder: place(page, folder) })
        }
      }
      // A page whose parent isn't there (it shouldn't happen) still comes out, at the top of its project.
      for (const page of pageRows) if (!pagePath.has(page.id) && projectFolder.has(page.projectId)) place(page, `documents/${projectFolder.get(page.projectId)}`)

      // Attachments: a card's under attachments/, a page's next to it.
      const filePath = new Map<string, string>()
      const cardFolder = new Map<string, string>()
      const cardFolderNames = namer()
      let orphans: string | undefined
      for (const file of fileRows) {
        let folder: string | undefined
        if (file.cardId) {
          folder = cardFolder.get(file.cardId)
          if (!folder) {
            folder = `attachments/${cardFolderNames(safeName(cardById.get(file.cardId)?.title ?? ''))}`
            cardFolder.set(file.cardId, folder)
          }
        } else {
          folder = pageFilesFolder.get(file.pageId ?? '') ?? (orphans ??= `attachments/${cardFolderNames('pages')}`)
        }
        const dot = file.filename.lastIndexOf('.')
        const stem = dot > 0 ? file.filename.slice(0, dot) : file.filename
        const ending = dot > 0 ? cleanName(file.filename.slice(dot + 1), 16) : ''
        const extension = ending ? `.${ending}` : ''
        const path = `${folder}/${namesIn(folder)(safeName(stem, 'file'), [extension])}${extension}`
        filePath.set(file.id, path)
        files.push({ path: `${base}/${path}`, storageKey: file.storageKey, size: file.size })
      }
      // Links to attachments and references to documents point at their files in the ZIP, relative
      // to where the text is; references to tasks at tasks.json, with the card's id (it is in there)
      // after the "#". One to anything that isn't in the export stays as it was.
      const target = (type: string, id: string) => (type.toLowerCase() === 'doc' ? pagePath.get(id) : cardById.has(id) ? 'tasks.json' : undefined)
      const relink = (markdown: string, fromDir: string) =>
        outsideCode(markdown, (text) =>
          text
            .replace(ATTACHMENT_LINK, (link, open: string, id: string) => (filePath.has(id.toLowerCase()) ? `${open}${linkTo(fromDir, filePath.get(id.toLowerCase())!)}` : link))
            .replace(REFERENCE, (link, open: string, type: string, id: string) => {
              const to = target(type, id.toLowerCase())
              if (!to) return link
              return `${open}${linkTo(fromDir, to)}${to === 'tasks.json' ? `#${id.toLowerCase()}` : ''}`
            }),
        )
      for (const page of pageRows) {
        const path = pagePath.get(page.id)
        if (path) texts.push([`${base}/${path}`, relink(page.content, path.slice(0, path.lastIndexOf('/')))])
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
                // What references to this task (#<id> after tasks.json) point at.
                id: card.id,
                title: card.title,
                description: relink(card.description, ''),
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
    return { texts, files, summary }
  }
}
