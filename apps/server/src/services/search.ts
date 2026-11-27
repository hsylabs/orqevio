import type { SearchResultDTO } from '@orqevio/shared'
import { UNSPACED_SCRIPT, markdownToPlainText } from '@orqevio/shared'
import { type SQL, sql } from 'drizzle-orm'
import { inList } from '../db/in-list'
import type { Actor } from '../auth/actor'
import { hasScope } from '../auth/actor'
import type { Access } from './access'
import type { Deps } from './deps'

/** Lowercase, without accents: the same folding the FTS5 tokenizers apply. */
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ς/g, 'σ')

/** Each character folded, as `fold` folds it, kept for the characters met again. */
const foldedChars = new Map<string, string>()
const foldChar = (ch: string) => {
  let f = foldedChars.get(ch)
  if (f === undefined) {
    f = fold(ch)
    if (foldedChars.size > 20_000) foldedChars.clear()
    foldedChars.set(ch, f)
  }
  return f
}

/**
 * `value` folded a character at a time, and for each UTF-16 unit of it, where in `value` its
 * character starts: folding changes the length of some text (a Korean syllable becomes its
 * letters, and a Thai vowel or tone mark nothing).
 */
function folded(value: string) {
  let text = ''
  const from: number[] = []
  let at = 0
  for (const ch of value) {
    const f = ch < '\u0080' ? ch.toLowerCase() : foldChar(ch)
    text += f
    for (let i = 0; i < f.length; i++) from.push(at)
    at += ch.length
  }
  return { text, from }
}

/** Words of the query that can be searched (at least one letter or digit). */
export function searchTerms(raw: string) {
  return raw
    .normalize('NFC')
    .split(/\s+/)
    .map((t) => t.replace(/["\p{Cc}]/gu, ''))
    .filter((t) => /[\p{L}\p{N}]/u.test(t))
    .slice(0, 8)
}

/**
 * How a term is looked for:
 * - `trigram`, three letters or more: anywhere in the text, in any language (議事録 in
 *   会議の議事録, «plan» in «Projektplan»), in the trigram index (0012);
 * - `text`, shorter, in a script without spaces (会議, 会议): anywhere in the text as well, read as
 *   it is, being too short for trigrams;
 * - `word`, shorter otherwise («ok», 기록), or with something other than letters and digits in it
 *   («l'équipe», «e-mail»): at the start of a word, in the word index (0001), which reads «l’équipe»
 *   and «e mail» as the same words. So are terms of hexadecimal digits alone («bed», «2025»), as
 *   before: anywhere, they would be found in the ids of the references to cards, pages and files
 *   that Markdown holds.
 *
 * `forms` are the term as typed (NFC) and decomposed (NFD) if that differs: text is indexed as it
 * was written, and some of it comes decomposed (がんばる pasted from a macOS file name).
 */
export interface Term {
  text: string
  forms: string[]
  by: 'trigram' | 'text' | 'word'
}

/**
 * The characters of a term as the trigram index counts them: without the accents it leaves out,
 * which NFC doesn't always join to their letter (the grave accent of Yoruba «ọ̀»).
 */
const trigramLength = (text: string) => [...text.replace(/[\u0300-\u036f]/g, '')].length

const kindOf = (text: string): Term['by'] => {
  if (!/^[\p{L}\p{M}\p{N}]+$/u.test(text) || /^[0-9a-f]+$/.test(fold(text))) return 'word'
  return trigramLength(text) >= 3 ? 'trigram' : UNSPACED_SCRIPT.test(text) ? 'text' : 'word'
}

export function planTerms(terms: string[]): Term[] {
  return terms.map((text) => ({ text, forms: [...new Set([text, text.normalize('NFD')])], by: kindOf(text) }))
}

/**
 * FTS5 query, every term a phrase in each of its forms: at the start of a word in the word index,
 * anywhere in the trigram one.
 */
const ftsQuery = (terms: Term[], column?: string) => {
  const query = terms
    .map((t) => {
      const phrases = t.forms.map((f) => (t.by === 'word' ? `"${f}"*` : `"${f}"`))
      return phrases.length > 1 ? `(${phrases.join(' OR ')})` : phrases[0]
    })
    .join(' AND ')
  return column ? `${column} : (${query})` : query
}

/** A LIKE pattern for a form of a term anywhere, its own % and _ taken as they are. */
const likePattern = (form: string) => `%${form.replace(/[\\%_]/g, '\\$&')}%`

/** One kind of thing searched: its table, its two indexes and the table that links their rowids to its rows. */
interface Searched {
  table: string
  alias: string
  words: string
  trigrams: string
  map: string
  /** The columns indexed, the first one its title if it has one. */
  columns: string[]
  title: boolean
  /** BM25 weights of the columns: a title counts more than a body. */
  weights: string
}

const CARDS: Searched = { table: 'cards', alias: 'c', words: 'cards_fts', trigrams: 'cards_trigram', map: 'cards_fts_map', columns: ['title', 'description'], title: true, weights: '10, 1' }
const PAGES: Searched = { table: 'pages', alias: 'pg', words: 'pages_fts', trigrams: 'pages_trigram', map: 'pages_fts_map', columns: ['title', 'content'], title: true, weights: '10, 1' }
const COMMENTS: Searched = {
  table: 'card_comments',
  alias: 'cm',
  words: 'card_comments_fts',
  trigrams: 'card_comments_trigram',
  map: 'card_comments_fts_map',
  columns: ['body'],
  title: false,
  weights: '1',
}

/**
 * The rows of one kind that hold every term, as SQL to put together:
 * - `from`, the rows with their alias and `rank` (lower is better). It starts from an index where
 *   one takes some of the terms, the trigram one first, so that a search reads what matches, not
 *   all there is; only with short terms in a script without spaces alone are the rows read whole.
 * - `where`, what the terms that index doesn't take ask of each row.
 * - `inTitle`, whether every term is in the row's title.
 */
function finder(kind: Searched, terms: Term[]) {
  const raw = sql.raw
  const x = raw(kind.alias)
  const groups = { trigram: terms.filter((t) => t.by === 'trigram'), word: terms.filter((t) => t.by === 'word'), text: terms.filter((t) => t.by === 'text') }
  const lead = groups.trigram.length ? 'trigram' : groups.word.length ? 'word' : null
  const indexOf = (by: 'trigram' | 'word') => raw(by === 'trigram' ? kind.trigrams : kind.words)

  const from = lead
    ? sql`(SELECT rowid AS key, bm25(${indexOf(lead)}, ${raw(kind.weights)}) AS rank FROM ${indexOf(lead)} WHERE ${indexOf(lead)} MATCH ${ftsQuery(groups[lead])}) f
        JOIN ${raw(kind.map)} m ON m.id = f.key
        JOIN ${raw(kind.table)} ${x} ON ${x}.id = m.entity_id`
    : sql`(SELECT 0 AS rank) f, ${raw(kind.table)} ${x}`

  const inIndex = (by: 'trigram' | 'word', column?: string) => sql`m.id IN (SELECT rowid FROM ${indexOf(by)} WHERE ${indexOf(by)} MATCH ${ftsQuery(groups[by], column)})`
  const like = (term: Term, columns: string[]) => sql`(${sql.join(
    columns.flatMap((c) => term.forms.map((f) => sql`${x}.${raw(c)} LIKE ${likePattern(f)} ESCAPE '\\'`)),
    sql` OR `,
  )})`

  const conditions: SQL[] = []
  if (lead === 'trigram' && groups.word.length) conditions.push(inIndex('word'))
  for (const term of groups.text) conditions.push(like(term, kind.columns))
  const where = conditions.length ? sql.join(conditions, sql` AND `) : sql`1`

  const titled: SQL[] = []
  if (kind.title) {
    for (const by of ['trigram', 'word'] as const) if (groups[by].length) titled.push(inIndex(by, kind.columns[0]))
    for (const term of groups.text) titled.push(like(term, [kind.columns[0]!]))
  }
  const inTitle = titled.length ? sql.join(titled, sql` AND `) : sql`0 = 1`
  return { from, where, inTitle }
}

function excerpt(text: string, terms: string[], size = 140) {
  const plain = markdownToPlainText(text)
  if (!plain) return ''
  const { text: inPlain, from } = folded(plain)
  const found = Math.min(...terms.map((t) => inPlain.indexOf(fold(t))).filter((i) => i >= 0))
  if (!Number.isFinite(found)) return plain.slice(0, size)
  const start = Math.max(0, from[found]! - 40)
  return `${start > 0 ? '…' : ''}${plain.slice(start, start + size)}${start + size < plain.length ? '…' : ''}`
}

const titleHit = (title: string, terms: string[]) => terms.some((t) => fold(title).includes(fold(t)))

export class SearchService {
  constructor(
    private readonly deps: Deps,
    private readonly access: Access,
  ) {}

  /** Full-text search over card and page titles and bodies (FTS5), titles ranked first, and card comments after them. */
  /** `archived`: archived cards are found too, and say so; otherwise only those on their boards. */
  async search(actor: Actor, workspaceId: string, rawQuery: string, opts: { types?: Array<'card' | 'page'>; limit?: number; archived?: boolean } = {}) {
    await this.access.workspace(actor, workspaceId)
    const terms = searchTerms(rawQuery.trim().slice(0, 100))
    if (terms.length === 0) return []
    const planned = planTerms(terms)
    const limit = Math.min(opts.limit ?? 20, 50)
    const types = opts.types ?? ['card', 'page']
    const results: SearchResultDTO[] = []

    if (types.includes('card') && hasScope(actor, 'tasks:read')) {
      const cards = finder(CARDS, planned)
      const rows = this.deps.db.all<{
        id: string
        title: string
        description: string
        boardId: string
        boardName: string
        columnName: string
        projectId: string
        projectName: string
        archivedAt: number | null
      }>(sql`
        SELECT c.id, c.title, c.description, b.id AS boardId, b.name AS boardName, col.name AS columnName,
               p.id AS projectId, p.name AS projectName, c.archived_at AS archivedAt
        FROM ${cards.from}
        JOIN boards b ON b.id = c.board_id
        JOIN board_columns col ON col.id = c.column_id
        JOIN projects p ON p.id = b.project_id
        WHERE c.workspace_id = ${workspaceId} AND (${opts.archived ? 1 : 0} OR c.archived_at IS NULL) AND ${cards.where}
        ORDER BY (${cards.inTitle}) DESC, f.rank, c.updated_at DESC
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
          ...(r.archivedAt !== null ? { archived: true } : {}),
        })
      }

      // Cards found by what a comment on them says, after those found by their own text: one
      // result each, with the comment that matches best, while there is room for more cards. Each
      // card's best comment is picked in SQLite, so many matching comments on a few cards never
      // leave another card out.
      const room = limit - results.length
      if (room > 0) {
        const found = finder(COMMENTS, planned)
        const comments = this.deps.db.all<{
          id: string
          body: string
          authorName: string
          cardId: string
          title: string
          boardId: string
          boardName: string
          columnName: string
          projectId: string
          projectName: string
          archivedAt: number | null
        }>(sql`
          SELECT id, body, authorName, cardId, title, boardId, boardName, columnName, projectId, projectName, archivedAt FROM (
            SELECT cm.id, cm.body, cm.author_name AS authorName, c.id AS cardId, c.title, b.id AS boardId, b.name AS boardName,
                   col.name AS columnName, p.id AS projectId, p.name AS projectName, c.archived_at AS archivedAt,
                   f.rank AS rank, cm.created_at AS createdAt,
                   row_number() OVER (PARTITION BY cm.card_id ORDER BY f.rank, cm.created_at DESC, cm.id) AS place
            FROM ${found.from}
            JOIN cards c ON c.id = cm.card_id
            JOIN boards b ON b.id = c.board_id
            JOIN board_columns col ON col.id = c.column_id
            JOIN projects p ON p.id = b.project_id
            WHERE cm.workspace_id = ${workspaceId} AND (${opts.archived ? 1 : 0} OR c.archived_at IS NULL)
              AND NOT ${inList(sql`c.id`, results.map((r) => r.id))} AND ${found.where}
          )
          WHERE place = 1
          ORDER BY rank, createdAt DESC
          LIMIT ${room}`)
        for (const r of comments) {
          results.push({
            type: 'card',
            id: r.cardId,
            title: r.title,
            excerpt: excerpt(r.body, terms),
            icon: null,
            projectId: r.projectId,
            projectName: r.projectName,
            boardId: r.boardId,
            boardName: r.boardName,
            columnName: r.columnName,
            comment: { id: r.id, author: r.authorName },
            ...(r.archivedAt !== null ? { archived: true } : {}),
          })
        }
      }
    }

    if (types.includes('page') && hasScope(actor, 'docs:read')) {
      const pages = finder(PAGES, planned)
      const rows = this.deps.db.all<{ id: string; title: string; icon: string | null; content: string; projectId: string; projectName: string }>(sql`
        SELECT pg.id, pg.title, pg.icon, pg.content, p.id AS projectId, p.name AS projectName
        FROM ${pages.from}
        JOIN projects p ON p.id = pg.project_id
        WHERE pg.workspace_id = ${workspaceId} AND ${pages.where}
        ORDER BY (${pages.inTitle}) DESC, f.rank, pg.updated_at DESC
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
