import { type DiffLine, HISTORY_BODY_KINDS, HISTORY_DAYS, type HistoryEntryDTO, diffLines } from '@orqevio/shared'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { t } from 'i18next'
import { Trans, useTranslation } from 'react-i18next'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Spinner } from '../../components/ui/Spinner'
import { cn } from '../../lib/cn'
import { dueLabel, formatList, relativeTime } from '../../lib/format'
import type historyCatalog from '../../i18n/locales/en/history.json'
import { useHistory, useHistoryEntry } from '../../lib/queries'

/** Every change of a page or a card from the last days, with who made it and, for texts, what changed line by line. */
export function HistoryDialog({ open, onOpenChange, type, id, name }: { open: boolean; onOpenChange: (open: boolean) => void; type: 'page' | 'card'; id: string; name: string }) {
  const { t } = useTranslation('history')
  const history = useHistory(type, id, open)
  const entries = history.data?.pages.flat() ?? []
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('title', { name })} description={t('intro', { count: HISTORY_DAYS })} width="max-w-[680px]">
      {history.isPending ? (
        <div className="grid place-items-center py-10">
          <Spinner />
        </div>
      ) : entries.length === 0 ? (
        <p className="py-6 text-center text-[13.5px] text-ink-3">{t('empty', { count: HISTORY_DAYS })}</p>
      ) : (
        <>
          <ol className="relative flex flex-col" aria-label={t('list')}>
            {entries.map((entry, i) => (
              <Entry key={entry.id} entry={entry} last={i === entries.length - 1} />
            ))}
          </ol>
          {history.hasNextPage && (
            <div className="mt-3 flex justify-center">
              <Button variant="ghost" size="sm" loading={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
                {t('older')}
              </Button>
            </div>
          )}
        </>
      )}
    </Dialog>
  )
}

function Entry({ entry, last }: { entry: HistoryEntryDTO; last: boolean }) {
  const { t } = useTranslation(['history', 'activity'])
  const [open, setOpen] = useState(false)
  const body = HISTORY_BODY_KINDS.has(entry.kind)
  const { key, values } = describe(entry)
  const detail = typeof entry.meta.movedTo === 'string' && entry.meta.movedTo ? t('movedTo', { place: entry.meta.movedTo }) : null
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0" aria-label={t('entry', { name: entry.actor.name, when: relativeTime(entry.updatedAt) })}>
      {!last && <span className="absolute top-7 bottom-0 left-[11px] w-px bg-line" aria-hidden="true" />}
      <Avatar name={entry.actor.name} kind={entry.actor.kind} size={24} className="relative z-[1] mt-px" />
      <div className="min-w-0 flex-1 text-[13px] leading-snug text-ink-2">
        <span className="break-words">
          <Trans t={t} i18nKey={key} values={{ actor: entry.actor.name, ...values }} components={{ actor: <span className={entry.actor.kind === 'agent' ? 'font-medium text-agent' : 'font-medium text-ink'} /> }} />
        </span>
        {detail && <span className="text-ink-3"> · {detail}</span>}
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-ink-3">
          <time dateTime={entry.updatedAt}>{relativeTime(entry.updatedAt)}</time>
          {entry.actor.kind === 'agent' && <span>{t('activity:viaMcp')}</span>}
          {body && (
            <span aria-label={t('lines', { added: entry.meta.linesAdded ?? 0, removed: entry.meta.linesRemoved ?? 0 })}>
              <span className="text-ok" aria-hidden="true">
                +{String(entry.meta.linesAdded ?? 0)}
              </span>{' '}
              <span className="text-danger" aria-hidden="true">
                −{String(entry.meta.linesRemoved ?? 0)}
              </span>
            </span>
          )}
        </span>
        {body && (
          <>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="mt-1.5 inline-flex items-center gap-1 rounded-[7px] px-1.5 py-0.5 -ml-1.5 text-[12px] font-medium text-ink-2 hover:bg-hover hover:text-ink"
            >
              {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              {open ? t('hideChanges') : t('showChanges')}
            </button>
            {open && <Changes id={entry.id} updatedAt={entry.updatedAt} />}
          </>
        )}
      </div>
    </li>
  )
}

function Changes({ id, updatedAt }: { id: string; updatedAt: string }) {
  const { t } = useTranslation('history')
  const entry = useHistoryEntry(id, updatedAt, true)
  if (entry.isPending) return <Spinner className="mt-2" />
  if (entry.isError) return <p className="mt-2 text-[12.5px] text-danger">{t('loadFailed')}</p>
  return <DiffView before={String(entry.data.before ?? '')} after={String(entry.data.after ?? '')} />
}

/** Lines shown around each change; longer stretches without changes fold away. */
const CONTEXT = 2

type Segment = { kind: 'line'; line: DiffLine } | { kind: 'fold'; count: number }

/** Folds long runs of unchanged lines, keeping a few around each change, as `git diff` does. */
function fold(lines: DiffLine[]): Segment[] {
  const near = new Array<boolean>(lines.length).fill(false)
  lines.forEach((line, i) => {
    if (line.type === 'same') return
    for (let j = Math.max(0, i - CONTEXT); j <= Math.min(lines.length - 1, i + CONTEXT); j++) near[j] = true
  })
  const out: Segment[] = []
  let hidden = 0
  lines.forEach((line, i) => {
    if (near[i]) {
      if (hidden) out.push({ kind: 'fold', count: hidden })
      hidden = 0
      out.push({ kind: 'line', line })
    } else hidden++
  })
  if (hidden) out.push({ kind: 'fold', count: hidden })
  return out
}

export function DiffView({ before, after }: { before: string; after: string }) {
  const { t } = useTranslation('history')
  const segments = useMemo(() => fold(diffLines(before, after)), [before, after])
  if (!segments.some((s) => s.kind === 'line')) return <p className="mt-2 text-[12.5px] text-ink-3">{t('noLineChanges')}</p>
  return (
    <div role="group" aria-label={t('diff')} className="mt-2 overflow-hidden rounded-[10px] border border-line bg-surface font-mono text-[12px] leading-[1.65]">
      {segments.map((segment, i) => {
        if (segment.kind === 'fold')
          return (
            <div key={i} className="bg-sunken px-3 py-0.5 text-[11.5px] text-ink-3">
              {t('unchanged', { count: segment.count })}
            </div>
          )
        const { type, text } = segment.line
        const content: ReactNode = (
          <>
            <span aria-hidden="true" className="w-4 shrink-0 select-none text-ink-3">
              {type === 'added' ? '+' : type === 'removed' ? '−' : ' '}
            </span>
            <span className="min-w-0 whitespace-pre-wrap break-words">{text || ' '}</span>
          </>
        )
        const row = 'flex px-3 no-underline'
        if (type === 'added')
          return (
            <ins key={i} className={cn(row, 'bg-ok/12 text-ink')}>
              <span className="sr-only">{t('added')}</span>
              {content}
            </ins>
          )
        if (type === 'removed')
          return (
            <del key={i} className={cn(row, 'bg-danger-soft text-ink')}>
              <span className="sr-only">{t('removed')}</span>
              {content}
            </del>
          )
        return (
          <div key={i} className={cn(row, 'text-ink-2')}>
            {content}
          </div>
        )
      })}
    </div>
  )
}

type Kinds = (typeof historyCatalog)['kinds']
type Base<K extends string> = K extends `${infer B}_${'one' | 'other'}` ? B : K
/** The sentences of the catalog, as `kinds.<entity>.<what>`. */
type KindKey = { [E in keyof Kinds]: `kinds.${E & string}.${Base<keyof Kinds[E] & string>}` }[keyof Kinds]

/** The sentence for a change, and what goes in it. */
function describe(entry: HistoryEntryDTO): { key: KindKey; values: Record<string, string | number> } {
  const { kind, before, after, meta } = entry
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  const names = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])
  // Each name in the quotes of the language shown.
  const quoted = (list: string[]) => formatList(list.map((name) => t('history:quoted', { name })))
  switch (kind) {
    case 'page.icon':
      return after ? { key: 'kinds.page.iconSet', values: { icon: text(after) } } : { key: 'kinds.page.iconRemoved', values: {} }
    case 'page.moved':
      return meta.to ? { key: 'kinds.page.movedInto', values: { to: text(meta.to) } } : { key: 'kinds.page.movedTop', values: {} }
    case 'card.due':
      return after ? { key: 'kinds.card.dueSet', values: { date: dueLabel(text(after)) } } : { key: 'kinds.card.dueRemoved', values: {} }
    case 'card.labels': {
      const added = names(meta.added)
      const removed = names(meta.removed)
      if (added.length && removed.length) return { key: 'kinds.card.labelsChanged', values: { added: quoted(added), removed: quoted(removed) } }
      return added.length ? { key: 'kinds.card.labelsAdded', values: { added: quoted(added), count: added.length } } : { key: 'kinds.card.labelsRemoved', values: { removed: quoted(removed), count: removed.length } }
    }
    case 'card.archived':
      return { key: after ? 'kinds.card.archived' : 'kinds.card.unarchived', values: {} }
    case 'item.done':
      return { key: after ? 'kinds.item.done' : 'kinds.item.undone', values: { text: text(meta.text) } }
    case 'page.created':
    case 'card.created':
      return { key: `kinds.${kind}` as KindKey, values: { column: text(meta.column) } }
    default:
      return {
        key: `kinds.${kind}` as KindKey,
        values: { before: text(before), after: text(after), title: text(meta.title), text: text(meta.text), checklist: text(meta.checklist), name: text(meta.name), page: text(meta.page), from: text(meta.from), to: text(meta.to) },
      }
  }
}
