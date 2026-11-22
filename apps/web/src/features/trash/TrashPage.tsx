import { MAX_TRASH_BATCH, TRASH_DAYS, type TrashContents, type TrashNodeDTO } from '@orqevio/shared'
import { ChevronRight, MoreHorizontal, RotateCcw, Trash2, X } from 'lucide-react'
import { type KeyboardEvent, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Checkbox } from '../../components/ui/Checkbox'
import { EmptyState } from '../../components/ui/EmptyState'
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from '../../components/ui/Menu'
import { Tooltip } from '../../components/ui/Tooltip'
import { useConfirm } from '../../components/ui/confirm'
import { errorMessage } from '../../lib/api'
import { cn } from '../../lib/cn'
import { bytes, dateTime, formatList, relativeTime } from '../../lib/format'
import { useTrash, useTrashTree } from '../../lib/queries'
import { purgeItem, purgeMany, purgeSummary } from '../../lib/trash'
import { PageHeader } from '../shell/PageHeader'
import { useWorkspace } from '../shell/workspace'
import { TrashIcon } from './icons'
import { useRestore, useRestoreMany } from './restore'

const CONTENTS = ['projects', 'boards', 'columns', 'cards', 'pages', 'checklists', 'items', 'comments', 'labels', 'attachments', 'links'] as const satisfies ReadonlyArray<keyof TrashContents>
const DAY = 86_400_000
/** The trash says when something goes for good only when that is this close. */
const SOON_DAYS = 3

const holds = (contents: TrashContents) => CONTENTS.some((k) => contents[k])

/** A row on screen: the thing, and the keys of what holds it in the trash, outermost first. */
interface RowInfo {
  node: TrashNodeDTO
  path: string[]
}

interface RowActions {
  open: Set<string>
  toggle: (key: string) => void
  restore: (node: TrashNodeDTO) => void
  purge: (node: TrashNodeDTO) => void
  restoring: string | null
  purging: string | null
  marked: string | null
  selected: Map<string, RowInfo>
  select: (info: RowInfo, on: boolean, range: boolean) => void
  /** Rows tell what they are as they render, for ranges and for moving with the keyboard. */
  seen: Map<string, RowInfo>
}

/**
 * Everything deleted in this workspace in the last TRASH_DAYS days, as a tree: what was deleted
 * hangs from what held it, also when that was deleted later. At the top is what can go straight
 * back to its place; what it held shows inside it. Several can be picked, to restore them or
 * delete them for good together; picking something takes what it holds with it.
 */
export function TrashPage() {
  const { t } = useTranslation(['trash', 'common'])
  const { workspaceId } = useWorkspace()
  const trash = useTrash(workspaceId)
  const nodes = useMemo(() => trash.data ?? [], [trash.data])
  const confirm = useConfirm()
  const [selected, setSelected] = useState<Map<string, RowInfo>>(() => new Map())
  const clear = useCallback(() => setSelected(new Map()), [])
  // Gone from the trash by its own row: no longer picked, nor is anything below it.
  const drop = useCallback((key: string) => setSelected((s) => new Map([...s].filter(([k, i]) => k !== key && !i.path.includes(key)))), [])
  const restore = useRestore(workspaceId, { onRestored: (r) => drop(`${r.kind}:${r.entityId}`) })
  const restoreMany = useRestoreMany(workspaceId, { onRestored: clear })
  const [params, setParams] = useSearchParams()
  const item = params.get('item')
  const target = useTrashTree(workspaceId, item)
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [purging, setPurging] = useState<string | null>(null)
  const anchor = useRef<string | null>(null)
  const seen = useRef(new Map<string, RowInfo>()).current
  const list = useRef<HTMLUListElement>(null)

  // Asked to show one thing: what holds it opens, and it is marked. Not (or no longer) in the
  // trash: said when it was never found, quietly forgotten once it has been restored.
  const found = useRef<string | null>(null)
  useEffect(() => {
    const tree = target.data
    if (tree) {
      found.current = item
      setOpen((s) => new Set([...s, ...tree.ancestors.map((a) => a.key)]))
    } else if (item && (tree === null || target.isError)) {
      if (found.current !== item) toast(t('notInTrash'))
      setParams((p) => (p.delete('item'), p), { replace: true })
    }
  }, [item, target.data, target.isError, setParams, t])

  // What left the trash (restored, deleted for good, by anyone) is no longer picked.
  useEffect(() => {
    if (!trash.data || selected.size === 0) return
    const tops = new Set(trash.data.map((n) => n.key))
    const still = [...selected.values()].filter((i) => tops.has(i.path[0] ?? i.node.key))
    if (still.length !== selected.size) setSelected(new Map(still.map((i) => [i.node.key, i])))
  }, [trash.data, selected])

  // Esc lets go of what is picked, unless a dialog is open: there, it closes the dialog.
  useEffect(() => {
    if (selected.size === 0) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"]')) return
      clear()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected.size, clear])

  // What is picked, without what is inside something else picked: that comes with it.
  const picked = [...selected.values()].filter((i) => !i.path.some((k) => selected.has(k)))
  // All there is, or as many as can go at once.
  const allTop = nodes.length > 0 && (nodes.every((n) => selected.has(n.key)) || picked.length >= MAX_TRASH_BATCH)

  function select(info: RowInfo, on: boolean, range: boolean) {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>('[data-trash-row]') ?? [])].map((el) => el.dataset.trashRow!)
    const from = anchor.current ? rows.indexOf(anchor.current) : -1
    const to = rows.indexOf(info.node.key)
    const keys = range && from >= 0 && to >= 0 ? rows.slice(Math.min(from, to), Math.max(from, to) + 1) : [info.node.key]
    setSelected((s) => {
      const next = new Map(s)
      // What counts: what is picked without something picked above it (what is inside comes with it).
      const counted = () => [...next.values()].filter((i) => !i.path.some((k) => next.has(k))).length
      for (const key of keys) {
        const row = key === info.node.key ? info : seen.get(key)
        if (!row) continue
        // Inside something picked in the same range: it comes with it, there is nothing to pick.
        if (on && key !== info.node.key && row.path.some((k) => next.has(k))) continue
        // Restoring or deleting goes up to MAX_TRASH_BATCH at a time: picking stops there, and says so.
        if (on && !next.has(key) && counted() >= MAX_TRASH_BATCH) {
          toast(t('selectLimit', { count: MAX_TRASH_BATCH }))
          break
        }
        if (on) next.set(key, row)
        else next.delete(key)
      }
      return next
    })
    anchor.current = info.node.key
  }

  async function purge(node: TrashNodeDTO) {
    const name = node.title || t('common:untitled')
    const describe = (contents: TrashContents) => CONTENTS.filter((k) => contents[k]).map((k) => t(`contents.${k}`, { count: contents[k]! }))
    const held = describe(node.contents)
    const earlier = describe(node.earlierContents)
    const description = [held.length ? t('purge.includes', { list: formatList(held) }) : '', earlier.length ? t('purge.earlier', { list: formatList(earlier) }) : '', t('purge.body')]
      .filter(Boolean)
      .join(' ')
    if (!(await confirm({ title: t('purge.title', { name }), description, confirmLabel: t('purge.confirm'), danger: true }))) return
    setPurging(node.key)
    try {
      await purgeItem(workspaceId, node.key)
      drop(node.key)
      toast.success(t('purge.done', { name }))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPurging(null)
    }
  }

  async function purgePicked() {
    const keys = picked.map((i) => i.node.key)
    setPurging('*')
    try {
      // How much goes is counted by the server: all that is below each, also what was deleted before.
      const summary = await purgeSummary(workspaceId, keys)
      const all = CONTENTS.filter((k) => summary.contents[k]).map((k) => t(`contents.${k}`, { count: summary.contents[k]! }))
      const description = [t('purgeMany.total', { list: formatList(all) }), summary.bytes ? t('purgeMany.size', { size: bytes(summary.bytes) }) : '', t('purge.body')].filter(Boolean).join(' ')
      if (!(await confirm({ title: t('purgeMany.title', { count: summary.count }), description, confirmLabel: t('purgeMany.confirm', { count: summary.count }), danger: true }))) return
      const went = await purgeMany(workspaceId, keys)
      toast.success(t('purgeMany.done', { count: went.count }))
      clear()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPurging(null)
    }
  }

  function restorePicked() {
    // One alone goes as from its own row: straight back when there is nothing to decide.
    if (picked.length === 1) return void restore.start(picked[0]!.node.key)
    void restoreMany.start(picked.map((i) => i.node))
  }

  const actions: RowActions = {
    open,
    toggle: (key) => setOpen((s) => (s.has(key) ? new Set([...s].filter((k) => k !== key)) : new Set([...s, key]))),
    restore: (node) => void restore.start(node.key),
    purge: (node) => void purge(node),
    restoring: restore.starting ?? (restoreMany.starting ? '*' : null),
    purging,
    marked: item,
    selected,
    select,
    seen,
  }
  const count = picked.length
  const busy = actions.restoring !== null || purging !== null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader crumbs={[{ label: t('title') }]} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn('mx-auto w-full max-w-[920px] px-4 py-10 sm:px-10', count > 0 && 'max-sm:pb-28')}>
          <div className="animate-rise">
            <h1 className="font-display text-[34px] leading-tight font-medium tracking-[-0.02em]">{t('title')}</h1>
            <p className="mt-2 max-w-[600px] text-[14px] leading-relaxed text-ink-2">{t('intro', { count: TRASH_DAYS })}</p>
          </div>
          {trash.isPending ? (
            <div className="mt-8 flex flex-col gap-2">
              <div className="skeleton h-[52px] rounded-[12px]" />
              <div className="skeleton h-[52px] rounded-[12px]" />
            </div>
          ) : nodes.length === 0 ? (
            <EmptyState icon={<Trash2 />} title={t('empty.title')}>
              {t('empty.body', { count: TRASH_DAYS })}
            </EmptyState>
          ) : (
            <>
              {/* Over the list; once something is picked, it says how many and what can be done, and stays in sight. */}
              <div
                role="toolbar"
                aria-label={t('selectAll')}
                className={cn(
                  'z-10 mt-8 mb-2 flex min-h-11 items-center gap-2 rounded-[12px] px-2.5',
                  count > 0 && 'sticky top-2 border border-line bg-surface shadow-md max-sm:fixed max-sm:inset-x-3 max-sm:top-auto max-sm:bottom-3 max-sm:mb-0',
                )}
              >
                <Checkbox
                  checked={allTop}
                  mixed={count > 0 && !allTop}
                  onChange={() => {
                    if (allTop) return clear()
                    if (nodes.length > MAX_TRASH_BATCH) toast(t('selectLimit', { count: MAX_TRASH_BATCH }))
                    setSelected(new Map(nodes.slice(0, MAX_TRASH_BATCH).map((n) => [n.key, { node: n, path: [] }])))
                  }}
                  label={t('selectAll')}
                  size={16}
                />
                {count > 0 ? (
                  <>
                    <span className="text-[13px] font-medium whitespace-nowrap">{t('selected', { count })}</span>
                    <span className="flex-1" />
                    <Button size="sm" variant="secondary" icon={<RotateCcw />} disabled={busy} loading={restoreMany.starting} onClick={restorePicked}>
                      {t('restore')}
                    </Button>
                    <Tooltip label={t('purge.action')}>
                      <Button size="sm" variant="ghost" icon={<Trash2 />} disabled={busy} loading={purging === '*'} onClick={() => void purgePicked()} aria-label={t('purge.action')} className="sm:hidden" iconOnly />
                    </Tooltip>
                    <Button size="sm" variant="ghost" icon={<Trash2 />} disabled={busy} loading={purging === '*'} onClick={() => void purgePicked()} className="text-danger max-sm:hidden">
                      {t('purge.action')}
                    </Button>
                    <Tooltip label={t('clearSelection')}>
                      <Button size="sm" variant="ghost" icon={<X />} iconOnly onClick={clear} aria-label={t('clearSelection')} />
                    </Tooltip>
                  </>
                ) : (
                  <span className="text-[13px] text-ink-3">{t('selectAll')}</span>
                )}
              </div>
              <p className="sr-only" aria-live="polite">
                {count > 0 ? t('selected', { count }) : ''}
              </p>
              <ul ref={list} className="flex flex-col gap-1.5" aria-label={t('title')}>
                {nodes.map((node) => (
                  <TopRow key={node.key} node={node} workspaceId={workspaceId} actions={actions} />
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
      {restore.dialog}
      {restoreMany.dialog}
    </div>
  )
}

function TopRow({ node, workspaceId, actions }: { node: TrashNodeDTO; workspaceId: string; actions: RowActions }) {
  const { t } = useTranslation(['trash', 'common'])
  const expanded = actions.open.has(node.key)
  const tree = useTrashTree(workspaceId, expanded ? node.key : null)
  const name = node.title || t('common:untitled')
  const children = useMemo(() => {
    const map = new Map<string, TrashNodeDTO[]>()
    for (const n of tree.data?.below ?? []) if (n.parentKey) map.set(n.parentKey, [...(map.get(n.parentKey) ?? []), n])
    return map
  }, [tree.data])
  const covered = actions.selected.has(node.key)

  return (
    <li data-trash-key={node.key} className={cn('rounded-[12px] border border-line bg-surface shadow-sm', actions.marked === node.key && 'ring-2 ring-accent')} aria-label={name}>
      <Row info={{ node, path: [] }} depth={0} expandable={holds(node.contents)} covered={false} actions={actions} />
      {expanded && (
        <div className="border-t border-line px-1.5 py-1">
          {tree.isPending ? (
            <div className="skeleton m-1.5 h-8 rounded-[8px]" />
          ) : (
            <ul aria-label={t('inside', { name })}>
              {(children.get(node.key) ?? []).map((n) => (
                <Branch key={n.key} node={n} path={[node.key]} childrenOf={children} actions={actions} covered={covered} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

function Branch({ node, path, childrenOf, actions, covered }: { node: TrashNodeDTO; path: string[]; childrenOf: Map<string, TrashNodeDTO[]>; actions: RowActions; covered: boolean }) {
  const { t } = useTranslation(['trash', 'common'])
  const below = childrenOf.get(node.key) ?? []
  const expanded = actions.open.has(node.key)
  const name = node.title || t('common:untitled')
  const inside = covered || actions.selected.has(node.key)
  return (
    <li data-trash-key={node.key} aria-label={name}>
      <Row info={{ node, path }} depth={path.length} expandable={below.length > 0} covered={covered} actions={actions} />
      {below.length > 0 && expanded && (
        <ul>
          {below.map((n) => (
            <Branch key={n.key} node={n} path={[...path, node.key]} childrenOf={childrenOf} actions={actions} covered={inside} />
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * One line on a computer: what it is, where it was and what it holds, who deleted it and when,
 * and what it can't do without deciding first; two lines on a phone, with its actions in a menu.
 * A click on a free part of the line picks it; Shift picks a range.
 */
function Row({ info, depth, expandable, covered, actions }: { info: RowInfo; depth: number; expandable: boolean; covered: boolean; actions: RowActions }) {
  const { t } = useTranslation(['trash', 'common'])
  const { node } = info
  actions.seen.set(node.key, info)
  const name = node.title || t('common:untitled')
  const expanded = actions.open.has(node.key)
  const picked = covered || actions.selected.has(node.key)
  const marked = actions.marked === node.key
  const markedRef = useMarked<HTMLDivElement>(marked)
  const held = CONTENTS.filter((k) => node.contents[k]).map((k) => t(`contents.${k}`, { count: node.contents[k]! }))
  const details = [t(`kind.${node.kind}`), node.location, held.length ? formatList(held) : '', node.bytes ? bytes(node.bytes) : ''].filter(Boolean).join(' · ')
  const left = Math.ceil((new Date(node.expiresAt).getTime() - Date.now()) / DAY)
  const holder = node.parentKey?.split(':')[0]
  // Said before any click: it can't go back to its place without deciding something first.
  const status =
    node.place === 'gone' ? t('placeGone') : node.place === 'trash' && holder && ['project', 'board', 'column', 'card', 'page', 'checklist'].includes(holder) ? t(`holderInTrash.${holder as 'board'}`) : ''
  const soon = left <= SOON_DAYS ? (left <= 0 ? t('expiresToday') : t('expiresIn', { count: left })) : ''
  const busy = actions.restoring !== null || actions.purging !== null

  function onClick(e: MouseEvent<HTMLDivElement>) {
    if (covered || (e.target as HTMLElement).closest('button,a,input,[role="menu"]')) return
    actions.select(info, !picked, e.shiftKey)
  }

  // The tree by keyboard, from a row's box: up and down move between rows, right opens, left closes.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // Keys pressed in its menu (drawn elsewhere, but inside it for React) are the menu's.
    if (!e.currentTarget.contains(e.target as Node)) return
    // What can take the focus: a row picked with what holds it has its box disabled.
    const boxes = [...document.querySelectorAll<HTMLElement>('[data-trash-row] [role="checkbox"]:not(:disabled)')]
    const at = boxes.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (at < 0) return
      e.preventDefault()
      boxes[at + (e.key === 'ArrowDown' ? 1 : -1)]?.focus()
    } else if (e.key === 'ArrowRight' && expandable && !expanded) {
      e.preventDefault()
      actions.toggle(node.key)
    } else if (e.key === 'ArrowLeft' && expandable && expanded) {
      e.preventDefault()
      actions.toggle(node.key)
    }
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the box in the row is the way by keyboard; a click on the rest of the line is a shortcut.
    <div
      ref={markedRef}
      data-trash-row={node.key}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={cn(
        'group flex min-h-[50px] items-center gap-2 rounded-[10px] py-1.5 pr-2 max-sm:flex-wrap max-sm:py-2',
        depth === 0 ? 'pl-2.5' : 'hover:bg-hover',
        picked && depth > 0 && 'bg-accent-soft/60',
        marked && depth > 0 && 'bg-accent-soft ring-2 ring-accent',
      )}
      style={depth > 0 ? { paddingLeft: 10 + depth * 20 } : undefined}
    >
      <Checkbox checked={picked} disabled={covered} onChange={(on, e) => actions.select(info, on, e.shiftKey)} label={t('select', { name })} size={16} />
      {expandable ? <Expander name={name} expanded={expanded} onToggle={() => actions.toggle(node.key)} /> : <span className="size-7 shrink-0" />}
      <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-sunken text-ink-3 [&_svg]:size-[15px]">
        <TrashIcon kind={node.kind} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-baseline gap-2">
          <span className="max-w-[55%] shrink-0 truncate text-[14px] font-semibold max-sm:max-w-full max-sm:shrink">{name}</span>
          <span className="min-w-0 truncate text-[12.5px] text-ink-3 max-sm:hidden">
            {details}
            {(status || soon) && <span className="text-warn"> · {[status, soon].filter(Boolean).join(' · ')}</span>}
          </span>
          {node.earlier && <span className="shrink-0 rounded-full bg-sunken px-2 py-px text-[11px] text-ink-3">{t('earlier')}</span>}
        </p>
      </div>
      <Who node={node} className="max-sm:hidden" />
      <div className="flex shrink-0 items-center gap-1 max-sm:hidden">
        <Button size="sm" variant={depth === 0 ? 'secondary' : 'ghost'} icon={<RotateCcw />} loading={actions.restoring === node.key} disabled={busy} onClick={() => actions.restore(node)} aria-label={t('restoreNamed', { name })}>
          {t('restore')}
        </Button>
        <Tooltip label={t('purge.action')}>
          <Button size="sm" variant="ghost" icon={<Trash2 />} iconOnly loading={actions.purging === node.key} disabled={busy} onClick={() => actions.purge(node)} aria-label={t('purge.named', { name })} />
        </Tooltip>
      </div>
      <MenuRoot>
        <MenuTrigger asChild>
          <Button size="sm" variant="ghost" icon={<MoreHorizontal />} iconOnly className="sm:hidden" disabled={busy} aria-label={t('more', { name })} />
        </MenuTrigger>
        <MenuContent>
          <MenuItem icon={<RotateCcw />} onSelect={() => actions.restore(node)}>
            {t('restore')}
          </MenuItem>
          <MenuItem icon={<Trash2 />} danger onSelect={() => actions.purge(node)}>
            {t('purge.action')}
          </MenuItem>
        </MenuContent>
      </MenuRoot>
      {/* On a phone, a second line: what it is, and who deleted it and when. */}
      <div className="flex w-full min-w-0 items-center gap-2 pl-[66px] text-[12px] text-ink-3 sm:hidden">
        <span className="min-w-0 flex-1 truncate">
          {details}
          {(status || soon) && <span className="text-warn"> · {[status, soon].filter(Boolean).join(' · ')}</span>}
        </span>
        <Who node={node} />
      </div>
    </div>
  )
}

/** Who deleted it, by their avatar, and when, with the exact date and when it goes for good on hover. */
function Who({ node, className }: { node: TrashNodeDTO; className?: string }) {
  const { t } = useTranslation('trash')
  const when = t('when', { date: dateTime(node.deletedAt), expires: dateTime(node.expiresAt) })
  return (
    <span className={cn('flex shrink-0 items-center gap-1.5 text-[12px] text-ink-3', className)}>
      <Tooltip label={t('deletedByShort', { name: node.deletedBy.name })}>
        <span className="inline-flex">
          <Avatar name={node.deletedBy.name} kind={node.deletedBy.kind} size={18} />
          <span className="sr-only">{t('deletedByShort', { name: node.deletedBy.name })}</span>
        </span>
      </Tooltip>
      <Tooltip label={when}>
        <time dateTime={node.deletedAt} className="whitespace-nowrap">
          {relativeTime(node.deletedAt)}
          <span className="sr-only">. {when}</span>
        </time>
      </Tooltip>
    </span>
  )
}

/** Shows what was asked for once it is on screen. */
function useMarked<T extends HTMLElement>(marked: boolean) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (marked) ref.current?.scrollIntoView({ block: 'center' })
  }, [marked])
  return ref
}

function Expander({ name, expanded, onToggle }: { name: string; expanded: boolean; onToggle: () => void }) {
  const { t } = useTranslation(['trash', 'common'])
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={t(expanded ? 'collapse' : 'expand', { name })}
      className="grid size-7 shrink-0 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink"
    >
      <ChevronRight className={cn('size-4 transition-transform duration-150', expanded && 'rotate-90')} />
    </button>
  )
}
