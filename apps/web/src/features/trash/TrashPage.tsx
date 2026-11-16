import { TRASH_DAYS, type TrashContents, type TrashEntryDTO, type TrashKind } from '@orqevio/shared'
import { Columns3, FileText, Folder, Link2, ListChecks, Paperclip, RotateCcw, SquareCheck, SquareKanban, StickyNote, Tag, Trash2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { useConfirm } from '../../components/ui/confirm'
import { ApiError, del, errorMessage } from '../../lib/api'
import { bytes, formatList, relativeTime } from '../../lib/format'
import { keys, queryClient, useTrash } from '../../lib/queries'
import { restoreFromTrash } from '../../lib/trash'
import { PageHeader } from '../shell/PageHeader'
import { useWorkspace } from '../shell/workspace'

const ICONS: Record<TrashKind, ReactNode> = {
  project: <Folder />,
  board: <SquareKanban />,
  column: <Columns3 />,
  card: <StickyNote />,
  page: <FileText />,
  attachment: <Paperclip />,
  label: <Tag />,
  checklist: <ListChecks />,
  checklist_item: <SquareCheck />,
  link: <Link2 />,
}

const CONTENTS = ['boards', 'columns', 'cards', 'pages', 'checklists', 'items', 'labels', 'attachments'] as const satisfies ReadonlyArray<keyof TrashContents>

/** Everything deleted in this workspace in the last TRASH_DAYS days, to bring back or delete for good. */
export function TrashPage() {
  const { t } = useTranslation(['trash', 'common'])
  const { workspaceId } = useWorkspace()
  const trash = useTrash(workspaceId)
  const entries = trash.data ?? []

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
          ) : entries.length === 0 ? (
            <EmptyState icon={<Trash2 />} title={t('empty.title')}>
              {t('empty.body', { count: TRASH_DAYS })}
            </EmptyState>
          ) : (
            <ul className="mt-8 flex flex-col gap-2" aria-label={t('title')}>
              {entries.map((entry) => (
                <TrashRow key={entry.id} entry={entry} workspaceId={workspaceId} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function TrashRow({ entry, workspaceId }: { entry: TrashEntryDTO; workspaceId: string }) {
  const { t } = useTranslation(['trash', 'common'])
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [busy, setBusy] = useState<'restore' | 'purge' | null>(null)
  const name = entry.title || t('common:untitled')
  const held = CONTENTS.filter((k) => entry.contents[k]).map((k) => t(`contents.${k}`, { count: entry.contents[k]! }))
  const details = [t(`kind.${entry.kind}`), entry.location, held.length ? formatList(held) : '', entry.bytes ? bytes(entry.bytes) : ''].filter(Boolean)

  async function restore() {
    setBusy('restore')
    try {
      const restored = await restoreFromTrash(entry.id)
      const open = restored.path ? { action: { label: t('open'), onClick: () => navigate(`/w/${workspaceId}/${restored.path}`) } } : {}
      toast.success(t('restored', { name }), { ...(restored.movedTo && { description: t('restoredElsewhere', { place: restored.movedTo }) }), ...open })
    } catch (error) {
      const holder = error instanceof ApiError && error.code === 'restore_place_in_trash' ? (error.details as { title?: string } | undefined)?.title : undefined
      toast.error(holder !== undefined ? t('restoreFirst', { name: holder || t('common:untitled') }) : errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  async function purge() {
    const ok = await confirm({ title: t('purge.title', { name }), description: t('purge.body'), confirmLabel: t('purge.confirm'), danger: true })
    if (!ok) return
    setBusy('purge')
    try {
      await del(`/trash/${entry.id}`)
      await queryClient.invalidateQueries({ queryKey: keys.trash(workspaceId) })
      toast.success(t('purge.done', { name }))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <li className="flex items-center gap-3.5 rounded-[12px] border border-line bg-surface px-4 py-3 shadow-sm max-sm:flex-wrap" aria-label={name}>
      <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-sunken text-ink-3 [&_svg]:size-[17px]">{ICONS[entry.kind]}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium">{name}</p>
        <p className="mt-0.5 truncate text-[12.5px] text-ink-3">{details.join(' · ')}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[12px] text-ink-3">
          <Avatar name={entry.deletedBy.name} kind={entry.deletedBy.kind} size={16} />
          <span>{t('deletedBy', { name: entry.deletedBy.name, when: relativeTime(entry.deletedAt) })}</span>
          <span aria-hidden>·</span>
          <span>{t('expires', { when: relativeTime(entry.expiresAt) })}</span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button size="sm" icon={<RotateCcw />} loading={busy === 'restore'} disabled={busy !== null} onClick={() => void restore()}>
          {t('restore')}
        </Button>
        <Button size="sm" variant="ghost" icon={<Trash2 />} loading={busy === 'purge'} disabled={busy !== null} onClick={() => void purge()} aria-label={t('purge.named', { name })}>
          {t('purge.action')}
        </Button>
      </div>
    </li>
  )
}
