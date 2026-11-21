import { asc, eq } from 'drizzle-orm'
import type { Actor } from '../auth/actor'
import { attachments, boards, cardComments, cardLabels, cardPageLinks, cards, checklistItems, checklists, columns, labels, pages, projects, workspaceMembers, workspaces } from '../db/schema'
import { notFound } from '../lib/errors'
import { ZipWriter } from '../lib/zip'
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

/**
 * Characters that show nothing (zero-width spaces, direction marks, blank fillers): two names that
 * differ only by them look the same, and some systems drop them. The joiner of emoji (U+200D) stays.
 */
const INVISIBLE = /(?!\u200D)[\p{Cf}\u115F\u1160\u3164\uFFA0]/gu

function cleanName(name: string, maxBytes: number) {
  // Composed, as Windows and Linux keep it: macOS takes "é" and "e" + accent as the same name.
  const clean = name.normalize('NFC').replace(INVISIBLE, '').replace(UNSAFE, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').replace(/[. ]+$/, '')
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
  // Compared as a file system that ignores case and normalization (macOS, Windows) would.
  const same = (name: string) => name.normalize('NFC').toLowerCase()
  const taken = new Set(reserved.map(same))
  const free = (stem: string, endings: string[]) => endings.every((ending) => !taken.has(same(`${stem}${ending}`)))
  /** The first free stem for every one of `endings` (just the name, by default), which it then takes. */
  return (name: string, endings = ['']) => {
    let stem = name
    for (let n = 2; !free(stem, endings); n++) stem = `${name} (${n})`
    for (const ending of endings) taken.add(same(`${stem}${ending}`))
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

/** A line indented as code: four spaces or a tab. */
const INDENTED = /^(?: {4}|\t)/
/** A list item, whose own lines are indented as much without being code. */
const LIST_ITEM = /^[ \t]{0,3}(?:>[ \t]?)*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/

/**
 * Applies `change` to a Markdown text but not to its code (fenced blocks, blocks indented by four
 * spaces after a blank line, and inline spans), which is kept exactly as it is: a link written in
 * an example is part of the example.
 */
export function outsideCode(markdown: string, change: (text: string) => string) {
  const out: string[] = []
  let text = ''
  const flush = () => {
    if (text) out.push(outsideInlineCode(text, change))
    text = ''
  }
  let fence: { char: string; size: number } | null = null
  let indented = false
  // A blank line before (or the start), outside a list: what an indented code block needs to begin.
  let blank = true
  let inList = false
  for (const line of markdown.split(/(?<=\n)/)) {
    const bare = line.replace(/\r?\n$/, '')
    const match = FENCE.exec(bare)
    if (fence) {
      out.push(line)
      if (match && match[1]![0] === fence.char && match[1]!.length >= fence.size && !match[2]!.trim()) fence = null
      continue
    }
    if (indented) {
      if (!bare.trim() || INDENTED.test(bare)) {
        out.push(line)
        blank = !bare.trim()
        continue
      }
      indented = false
    }
    if (match && !(match[1]![0] === '`' && match[2]!.includes('`'))) {
      flush()
      out.push(line)
      fence = { char: match[1]![0]!, size: match[1]!.length }
    } else if (blank && !inList && INDENTED.test(bare) && bare.trim()) {
      flush()
      out.push(line)
      indented = true
    } else {
      text += line
      if (LIST_ITEM.test(bare)) inList = true
      // Text back at the margin, after a blank line, ends the list.
      else if (bare.trim() && !/^[ \t]/.test(bare) && blank) inList = false
    }
    blank = !bare.trim()
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

/** How many files a page's download checks in storage at once. */
const EXISTS_AT_ONCE = 8

interface FileEntry {
  path: string
  storageKey: string
  size: number
}

type PageRow = typeof pages.$inferSelect
type FileRow = typeof attachments.$inferSelect
type Namer = ReturnType<typeof namer>

/** Rows by a key, each group in the order the rows came. */
function group<T, K>(rows: T[], key: (row: T) => K) {
  const groups = new Map<K, T[]>()
  for (const row of rows) {
    const bucket = groups.get(key(row))
    if (bucket) bucket.push(row)
    else groups.set(key(row), [row])
  }
  return (k: K) => groups.get(k) ?? []
}

const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name)

/** A namer for each folder: what goes in one never takes the name of something already there. */
function folderNamers() {
  const names = new Map<string, Namer>()
  return (folder: string) => {
    let namer_ = names.get(folder)
    if (!namer_) names.set(folder, (namer_ = namer()))
    return namer_
  }
}

/**
 * Pages laid out as files: each a Markdown file, its subpages in a folder of the same name, its
 * attachments in "<name> (files)" when it has any (`withFiles`).
 */
function pageLayout(pageRows: PageRow[], withFiles: Set<string>, namesIn: (folder: string) => Namer) {
  const pagePath = new Map<string, string>()
  const filesFolder = new Map<string, string>()
  const byParent = group(pageRows, (page) => page.parentId ?? `project:${page.projectId}`)
  /** Puts a page in `folder`, and gives the folder of its subpages. */
  const place = (page: PageRow, folder: string) => {
    const names = namesIn(folder)
    // Its text and the folder of its subpages: "A.md" and "A", both free (a sibling "A.md" would take "A.md" as a folder).
    const stem = names(safeName(page.title), ['.md', ''])
    pagePath.set(page.id, join(folder, `${stem}.md`))
    if (withFiles.has(page.id)) filesFolder.set(page.id, join(folder, names(`${stem} (files)`)))
    return join(folder, stem)
  }
  /** Puts what hangs from `key` (a page's id, or "project:<id>") in `folder`, all the way down. Without recursion: a tree has no depth limit. */
  const placeUnder = (key: string, folder: string) => {
    const pending = [{ key, folder }]
    while (pending.length) {
      const next = pending.pop()!
      for (const page of byParent(next.key)) {
        if (pagePath.has(page.id)) continue
        pending.push({ key: page.id, folder: place(page, next.folder) })
      }
    }
  }
  return { pagePath, filesFolder, byParent, place, placeUnder }
}

/** Where an attachment goes in `folder`: its name made safe and free there, its extension kept. */
function placeFile(file: FileRow, folder: string, namesIn: (folder: string) => Namer) {
  const dot = file.filename.lastIndexOf('.')
  const stem = dot > 0 ? file.filename.slice(0, dot) : file.filename
  const ending = dot > 0 ? cleanName(file.filename.slice(dot + 1), 16) : ''
  const extension = ending ? `.${ending}` : ''
  return join(folder, `${namesIn(folder)(safeName(stem, 'file'), [extension])}${extension}`)
}

/**
 * Where links to attachments and references to pages and cards point, rewritten outside code.
 * `to` gives a link's new destination, or undefined to leave it as it is; `absolute` says an
 * attachment's link had an address of its own (https://…) before /api/attachments.
 */
function relink(markdown: string, to: { attachment(id: string, absolute: boolean): string | undefined; reference(type: 'doc' | 'card', id: string): string | undefined }) {
  return outsideCode(markdown, (text) =>
    text
      .replace(ATTACHMENT_LINK, (link, open: string, id: string) => {
        const destination = to.attachment(id.toLowerCase(), !link.slice(open.length).startsWith('/'))
        return destination === undefined ? link : `${open}${destination}`
      })
      .replace(REFERENCE, (link, open: string, type: string, id: string) => {
        const destination = to.reference(type.toLowerCase() as 'doc' | 'card', id.toLowerCase())
        return destination === undefined ? link : `${open}${destination}`
      }),
  )
}

/** The ids of the attachments a text links to, outside code. */
function linkedAttachments(markdown: string) {
  const ids = new Set<string>()
  outsideCode(markdown, (text) => {
    for (const match of text.matchAll(ATTACHMENT_LINK)) ids.add(match[2]!.toLowerCase())
    return text
  })
  return ids
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
    const body = this.zip(async (zip) => {
      // An attachment whose file is gone from storage (a backup restored without it, say) is listed, never an empty file.
      const missing = new Set<string>()
      for (const file of files) if (!(await this.deps.storage.exists(file.storageKey))) missing.add(file.path)
      const about = { format: EXPORT_FORMAT, version: 1, app: VERSION, exportedAt: now.toISOString(), workspaces: summary, missingAttachments: [...missing].map((path) => path.slice(root.length + 1)) }
      await zip.add(`${root}/export.json`, utf8.encode(`${JSON.stringify(about, null, 2)}\n`), now)
      for (const [path, content] of texts) await zip.add(path, utf8.encode(content), now)
      await this.addFiles(
        zip,
        files.filter((file) => !missing.has(file.path)),
        now,
      )
    })
    return { body, filename: `${root}.zip` }
  }

  /**
   * One page to take elsewhere, written as the export writes it: its Markdown alone when that is all
   * it is; otherwise a ZIP with the attachments it shows or links to next to it, and with its
   * subpages in folders when asked. Links to anything that doesn't go with it (tasks, other pages,
   * other files) point at this copy, `origin`. People only, as the export.
   */
  async page(actor: Actor, pageId: string, options: { subpages: boolean; origin: string }) {
    this.access.requireUser(actor)
    const db = this.deps.db
    const [root] = await db.select().from(pages).where(eq(pages.id, pageId))
    if (!root) throw notFound('Page')
    await this.access.workspace(actor, root.workspaceId)
    // The page, and the pages under it when asked: walked without recursion, a tree has no depth limit.
    const included = [root]
    const seen = new Set([root.id])
    if (options.subpages) {
      const projectPages = await db.select().from(pages).where(eq(pages.projectId, root.projectId)).orderBy(asc(pages.position), asc(pages.id))
      const childrenOf = group(projectPages, (page) => page.parentId)
      for (let i = 0; i < included.length; i++)
        for (const child of childrenOf(included[i]!.id))
          if (!seen.has(child.id)) {
            seen.add(child.id)
            included.push(child)
          }
    }

    // Its own attachments go next to each page; one it links to from elsewhere in the workspace, next
    // to the first page that does. One whose file is gone from storage stays a link to this copy.
    // Read by workspace, not listed by id: a Durable Object takes at most 100 bound values in a query.
    const fileRows = await db.select().from(attachments).where(eq(attachments.workspaceId, root.workspaceId)).orderBy(asc(attachments.createdAt), asc(attachments.id))
    const fileById = new Map(fileRows.map((file) => [file.id, file]))
    const nextTo = new Map<string, string>()
    for (const file of fileRows) if (file.pageId && seen.has(file.pageId)) nextTo.set(file.id, file.pageId)
    for (const page of included) for (const id of linkedAttachments(page.content)) if (fileById.has(id) && !nextTo.has(id)) nextTo.set(id, page.id)
    const ids = [...nextTo.keys()]
    for (let i = 0; i < ids.length; i += EXISTS_AT_ONCE) {
      const batch = ids.slice(i, i + EXISTS_AT_ONCE)
      const there = await Promise.all(batch.map((id) => this.deps.storage.exists(fileById.get(id)!.storageKey)))
      batch.forEach((id, k) => !there[k] && nextTo.delete(id))
    }

    const namesIn = folderNamers()
    const layout = pageLayout(included, new Set(nextTo.values()), namesIn)
    const under = layout.place(root, '')
    if (options.subpages) layout.placeUnder(root.id, under)
    const filePath = new Map<string, string>()
    const files: FileEntry[] = []
    for (const [id, pageId] of nextTo) {
      const file = fileById.get(id)!
      const path = placeFile(file, layout.filesFolder.get(pageId)!, namesIn)
      filePath.set(id, path)
      files.push({ path, storageKey: file.storageKey, size: file.size })
    }
    const copy = (path: string) => `${options.origin}${path}`
    const texts = included.map((page): [string, string] => {
      const path = layout.pagePath.get(page.id)!
      const fromDir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      const markdown = relink(page.content, {
        // A link with an address of its own already leads somewhere without this copy's.
        attachment: (id, absolute) => (filePath.has(id) ? linkTo(fromDir, filePath.get(id)!) : absolute ? undefined : copy(`/api/attachments/${id}`)),
        reference: (type, id) => (type === 'doc' && layout.pagePath.has(id) ? linkTo(fromDir, layout.pagePath.get(id)!) : copy(`/${type}/${id}`)),
      })
      return [path, markdown]
    })

    const stem = layout.pagePath.get(root.id)!.slice(0, -'.md'.length)
    if (texts.length === 1 && files.length === 0) return { body: texts[0]![1], filename: `${stem}.md`, type: 'text/markdown; charset=utf-8' }
    const now = new Date()
    const body = this.zip(async (zip) => {
      for (const [path, content] of texts) await zip.add(path, utf8.encode(content), now)
      await this.addFiles(zip, files, now)
    })
    return { body, filename: `${stem}.zip`, type: 'application/zip' }
  }

  /** A ZIP written by `fill`, as a stream: each piece waits for the reader to take the last one, so memory stays flat whatever the size. */
  private zip(fill: (zip: ZipWriter) => Promise<void>) {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
    const writer = writable.getWriter()
    const zip = new ZipWriter((chunk) => writer.write(chunk))
    void (async () => {
      try {
        await fill(zip)
        await zip.end()
        await writer.close()
      } catch (error) {
        console.error('[export] failed', error)
        await writer.abort(error).catch(() => {})
      }
    })()
    return readable
  }

  /** The attachments' files, streamed one by one from storage. One gone meanwhile is left out. */
  private async addFiles(zip: ZipWriter, files: FileEntry[], now: Date) {
    for (const file of files) {
      const body = await this.deps.storage.stream(file.storageKey)
      if (body) await zip.addStream(file.path, file.size, body as ReadableStream<Uint8Array>, now)
    }
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
      const commentRows = db.select().from(cardComments).where(eq(cardComments.workspaceId, workspace.id)).orderBy(asc(cardComments.createdAt), asc(cardComments.id)).all()
      // Joined rather than listed by id: a Durable Object takes at most 100 bound values in a query.
      const cardLabelRows = db.select({ cardId: cardLabels.cardId, labelId: cardLabels.labelId }).from(cardLabels).innerJoin(cards, eq(cards.id, cardLabels.cardId)).where(eq(cards.workspaceId, workspace.id)).all()
      const linkRows = db.select({ cardId: cardPageLinks.cardId, pageId: cardPageLinks.pageId }).from(cardPageLinks).innerJoin(cards, eq(cards.id, cardPageLinks.cardId)).where(eq(cards.workspaceId, workspace.id)).all()
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
      const commentsOf = group(commentRows, (c) => c.cardId)

      // Documents: each project a folder, each page a Markdown file, its subpages in a folder of the
      // same name, its attachments in "<name> (files)".
      const namesIn = folderNamers()
      const projectFolders = namer()
      const projectFolder = new Map(projectRows.map((p) => [p.id, projectFolders(safeName(p.name))]))
      const withFiles = new Set(fileRows.map((f) => f.pageId).filter((id): id is string => Boolean(id)))
      const { pagePath, filesFolder: pageFilesFolder, place, placeUnder } = pageLayout(pageRows, withFiles, namesIn)
      for (const project of projectRows) placeUnder(`project:${project.id}`, `documents/${projectFolder.get(project.id)}`)
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
        const path = placeFile(file, folder, namesIn)
        filePath.set(file.id, path)
        files.push({ path: `${base}/${path}`, storageKey: file.storageKey, size: file.size })
      }
      // Links to attachments and references to documents point at their files in the ZIP, relative
      // to where the text is; references to tasks at tasks.json, with the card's id (it is in there)
      // after the "#". One to anything that isn't in the export stays as it was.
      const relinked = (markdown: string, fromDir: string) =>
        relink(markdown, {
          attachment: (id) => (filePath.has(id) ? linkTo(fromDir, filePath.get(id)!) : undefined),
          reference: (type, id) => {
            if (type === 'doc') return pagePath.has(id) ? linkTo(fromDir, pagePath.get(id)!) : undefined
            return cardById.has(id) ? `${linkTo(fromDir, 'tasks.json')}#${id}` : undefined
          },
        })
      for (const page of pageRows) {
        const path = pagePath.get(page.id)
        if (path) texts.push([`${base}/${path}`, relinked(page.content, path.slice(0, path.lastIndexOf('/')))])
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
                description: relinked(card.description, ''),
                labels: labelsOfCard(card.id)
                  .map((cl) => labelById.get(cl.labelId)?.name)
                  .filter(Boolean),
                due: day(card.dueAt),
                archived: card.archivedAt !== null,
                checklists: checklistsOf(card.id).map((list) => ({ title: list.title, items: itemsOf(list.id).map((i) => ({ text: i.text, done: i.done })) })),
                // A document linked by hand and mentioned too is one document.
                documents: [...new Set(linksOf(card.id).map((link) => pagePath.get(link.pageId)))].filter(Boolean),
                attachments: filesOf(card.id).map((f) => filePath.get(f.id)),
                // Oldest first, as a conversation reads.
                comments: commentsOf(card.id).map((c) => ({
                  author: c.authorName,
                  by: c.authorKind === 'agent' ? 'agent' : 'person',
                  body: relinked(c.body, ''),
                  createdAt: iso(c.createdAt),
                  editedAt: c.editedAt ? iso(c.editedAt) : null,
                })),
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
