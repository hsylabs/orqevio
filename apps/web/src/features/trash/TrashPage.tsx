import { TRASH_DAYS, type TrashContents, type TrashNodeDTO } from '@orqevio/shared'
import { ChevronRight, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { useConfirm } from '../../components/ui/confirm'
import { errorMessage } from '../../lib/api'
import { cn } from '../../lib/cn'
import { bytes, formatList, relativeTime } from '../../lib/format'
import { useTrash, useTrashTree } from '../../lib/queries'
import { purgeItem } from '../../lib/trash'
import { PageHeader } from '../shell/PageHeader'
import { useWorkspace } from '../shell/workspace'
import { TrashIcon } from './icons'
import { useRestore } from './restore'

const CONTENTS = ['boards', 'columns', 'cards', 'pages', 'checklists', 'items', 'labels', 'attachments', 'links'] as const satisfies ReadonlyArray<keyof TrashContents>

const holds = (contents: TrashContents) => CONTENTS.some((k) => contents[k])

interface RowActions {
  open: Set<string>
  toggle: (key: string) => void
  restore: (node: TrashNodeDTO) => void
  purge: (node: TrashNodeDTO) => void
  restoring: string | null
  purging: string | null
  marked: string | null
}

/**
 * Everything deleted in this workspace in the last TRASH_DAYS days, as a tree: what was deleted
 * hangs from what held it, also when that was deleted later. At the top is what can go straight
 * back to its place; what it held shows inside it.
 */
export function TrashPage() {
  const { t } = useTranslation(['trash', 'common'])
  const { workspaceId } = useWorkspace()
  const trash = useTrash(workspaceId)
  const nodes = trash.data ?? []
  const confirm = useConfirm()
  const restore = useRestore(workspaceId)
  const [params, setParams] = useSearchParams()
  const item = params.get('item')
  const target = useTrashTree(workspaceId, item)
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [purging, setPurging] = useState<string | null>(null)

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

  async function purge(node: TrashNodeDTO) {
    const name = node.title || t('common:untitled')
    const list = (contents: TrashContents) => CONTENTS.filter((k) => contents[k]).map((k) => t(`contents.${k}`, { count: contents[k]! }))
    const held = list(node.contents)
    const earlier = list(node.earlierContents)
    const description = [held.length ? t('purge.includes', { list: formatList(held) }) : '', earlier.length ? t('purge.earlier', { list: formatList(earlier) }) : '', t('purge.body')]
      .filter(Boolean)
      .join(' ')
    if (!(await confirm({ title: t('purge.title', { name }), description, confirmLabel: t('purge.confirm'), danger: true }))) return
    setPurging(node.key)
    try {
      await purgeItem(workspaceId, node.key)
      toast.success(t('purge.done', { name }))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPurging(null)
    }
  }

  const actions: RowActions = {
    open,
    toggle: (key) => setOpen((s) => (s.has(key) ? new Set([...s].filter((k) => k !== key)) : new Set([...s, key]))),
    restore: (node) => void restore.start(node.key),
    purge: (node) => void purge(node),
    restoring: restore.starting,
    purging,
    marked: item,
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader crumbs={[{ label: t('title') }]} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[880px] px-6 py-10 sm:px-10">
          <div className="animate-rise">
            <h1 className="font-display text-[34px] leading-tight font-medium tracking-[-0.02em]">{t('title')}</h1>
            <p className="mt-2 max-w-[600px] text-[14px] leading-relaxed text-ink-2">{t('intro', { count: TRASH_DAYS })}</p>
          </div>
          {trash.isPending ? (
            <div className="mt-8 flex flex-col gap-2">
              <div className="skeleton h-[76px] rounded-[12px]" />
              <div className="skeleton h-[76px] rounded-[12px]" />
            </div>
          ) : nodes.length === 0 ? (
            <EmptyState icon={<Trash2 />} title={t('empty.title')}>
              {t('empty.body', { count: TRASH_DAYS })}
            </EmptyState>
          ) : (
            <ul className="mt-8 flex flex-col gap-2" aria-label={t('title')}>
              {nodes.map((node) => (
                <TopRow key={node.key} node={node} workspaceId={workspaceId} actions={actions} />
              ))}
            </ul>
          )}
        </div>
      </div>
      {restore.dialog}
    </div>
  )
}

function TopRow({ node, workspaceId, actions }: { node: TrashNodeDTO; workspaceId: string; actions: RowActions }) {
  const { t } = useTranslation(['trash', 'common'])
  const expanded = actions.open.has(node.key)
  const tree = useTrashTree(workspaceId, expanded ? node.key : null)
  const markedRef = useMarked<HTMLLIElement>(actions.marked === node.key)
  const name = node.title || t('common:untitled')
  const held = CONTENTS.filter((k) => node.contents[k]).map((k) => t(`contents.${k}`, { count: node.contents[k]! }))
  const details = [t(`kind.${node.kind}`), node.location, held.length ? formatList(held) : '', node.bytes ? bytes(node.bytes) : ''].filter(Boolean)
  const children = useMemo(() => {
    const map = new Map<string, TrashNodeDTO[]>()
    for (const n of tree.data?.below ?? []) if (n.parentKey) map.set(n.parentKey, [...(map.get(n.parentKey) ?? []), n])
    return map
  }, [tree.data])

  return (
    <li
      data-trash-key={node.key}
      ref={markedRef}
      className={cn('rounded-[12px] border border-line bg-surface shadow-sm', actions.marked === node.key && 'ring-2 ring-accent')}
      aria-label={name}
    >
      <div className="flex items-center gap-3 px-3 py-3 max-sm:flex-wrap sm:pl-2">
        <Expander node={node} expanded={expanded} onToggle={() => actions.toggle(node.key)} />
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-sunken text-ink-3 [&_svg]:size-[17px]">
          <TrashIcon kind={node.kind} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">{name}</p>
          <p className="mt-0.5 truncate text-[12.5px] text-ink-3">{details.join(' · ')}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[12px] text-ink-3">
            <Avatar name={node.deletedBy.name} kind={node.deletedBy.kind} size={16} />
            <span>{t('deletedBy', { name: node.deletedBy.name, when: relativeTime(node.deletedAt) })}</span>
            <span aria-hidden>·</span>
            <span>{t('expires', { when: relativeTime(node.expiresAt) })}</span>
            {node.place === 'gone' && (
              <>
                <span aria-hidden>·</span>
                <span className="text-warn">{t('placeGone')}</span>
              </>
            )}
          </p>
        </div>
        <Actions node={node} name={name} actions={actions} />
      </div>
      {expanded && (
        <div className="border-t border-line px-2 py-1.5">
          {tree.isPending ? (
            <div className="skeleton m-1.5 h-8 rounded-[8px]" />
          ) : (
            <ul aria-label={t('inside', { name })}>
              {(children.get(node.key) ?? []).map((n) => (
                <Branch key={n.key} node={n} depth={0} childrenOf={children} actions={actions} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

function Branch({ node, depth, childrenOf, actions }: { node: TrashNodeDTO; depth: number; childrenOf: Map<string, TrashNodeDTO[]>; actions: RowActions }) {
  const { t } = useTranslation(['trash', 'common'])
  const below = childrenOf.get(node.key) ?? []
  const expanded = actions.open.has(node.key)
  const name = node.title || t('common:untitled')
  const marked = actions.marked === node.key
  const markedRef = useMarked<HTMLDivElement>(marked)
  return (
    <li data-trash-key={node.key} aria-label={name}>
      <div
        ref={markedRef}
        className={cn('group flex min-h-10 items-center gap-2 rounded-[9px] py-1 pr-1.5 hover:bg-hover', marked && 'bg-accent-soft ring-2 ring-accent')}
        style={{ paddingLeft: depth * 20 }}
      >
        {below.length > 0 ? <Expander node={node} expanded={expanded} onToggle={() => actions.toggle(node.key)} small /> : <span className="size-7 shrink-0" />}
        <span className="text-ink-3 [&_svg]:size-4">
          <TrashIcon kind={node.kind} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px]">
            {name} <span className="text-[12px] text-ink-3">· {t(`kind.${node.kind}`)}</span>
          </p>
          {node.earlier && (
            <p className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-ink-3">
              <span className="rounded-full bg-sunken px-2 py-px text-[11px]">{t('earlier')}</span>
              <span>{t('deletedBy', { name: node.deletedBy.name, when: relativeTime(node.deletedAt) })}</span>
            </p>
          )}
        </div>
        <Actions node={node} name={name} actions={actions} compact />
      </div>
      {below.length > 0 && expanded && (
        <ul>
          {below.map((n) => (
            <Branch key={n.key} node={n} depth={depth + 1} childrenOf={childrenOf} actions={actions} />
          ))}
        </ul>
      )}
    </li>
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

function Expander({ node, expanded, onToggle, small }: { node: TrashNodeDTO; expanded: boolean; onToggle: () => void; small?: boolean }) {
  const { t } = useTranslation(['trash', 'common'])
  if (!holds(node.contents)) return <span className={cn('shrink-0', small ? 'size-7' : 'size-7 max-sm:hidden')} />
  const name = node.title || t('common:untitled')
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

function Actions({ node, name, actions, compact }: { node: TrashNodeDTO; name: string; actions: RowActions; compact?: boolean }) {
  const { t } = useTranslation(['trash', 'common'])
  const busy = actions.restoring !== null || actions.purging !== null
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Button
        size="sm"
        variant={compact ? 'ghost' : 'secondary'}
        icon={<RotateCcw />}
        loading={actions.restoring === node.key}
        disabled={busy}
        onClick={() => actions.restore(node)}
        aria-label={t('restoreNamed', { name })}
      >
        {/* Inside the tree on a phone, the icon alone: the name needs the room. */}
        <span className={compact ? 'max-sm:hidden' : undefined}>{t('restore')}</span>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        icon={<Trash2 />}
        loading={actions.purging === node.key}
        disabled={busy}
        onClick={() => actions.purge(node)}
        iconOnly={compact}
        aria-label={t('purge.named', { name })}
      >
        {compact ? null : t('purge.action')}
      </Button>
    </div>
  )
}
