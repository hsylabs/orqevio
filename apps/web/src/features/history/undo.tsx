import type { ActorRef, HistoryEntryDTO, PageDTO, UndoPlanItemDTO, UndoResultDTO } from '@orqevio/shared'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { errorMessage, get, post } from '../../lib/api'
import { openInApp, trashHref } from '../../lib/trash'
import { queryClient } from '../../lib/queries'
import { announcePage } from '../../lib/realtime'
import { useWorkspace } from '../shell/workspace'

type Target = { ids: string[] }
type Asking = { target: Target; plan: UndoPlanItemDTO[]; bulk: boolean; name: string }

/** What undoing touches: refetch whatever of it is on screen. */
function refresh() {
  for (const key of ['history', 'history-entry', 'card', 'page', 'board', 'archived', 'overview', 'trash']) void queryClient.invalidateQueries({ queryKey: [key] })
}

/**
 * An open page shows its new text through a live update, which may not come (offline for a moment,
 * reconnecting): tell it directly, with its version now. A card's sheet follows its refetched data.
 */
async function syncPages(ids: Iterable<string>, me: ActorRef) {
  for (const pageId of new Set(ids)) {
    const page = await get<PageDTO>(`/pages/${pageId}`).catch(() => null)
    if (page) announcePage({ action: 'page.updated', pageId, version: page.version, actor: me })
  }
}

/** A text value, short enough to quote in a sentence. */
const quote = (value: unknown) => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return text.length > 120 ? `${text.slice(0, 119)}…` : text
}

/**
 * Undoing from the history: one change, asking only if someone changed it since; or everything
 * someone did from a change on, always saying first what will happen. Returns the actions and the
 * dialog to render.
 */
export function useUndo() {
  const { t } = useTranslation(['history', 'trash'])
  const { me, workspaceId } = useWorkspace()
  const self: ActorRef = { kind: 'user', id: me.user.id, name: me.user.name }
  const [asking, setAsking] = useState<Asking | null>(null)
  const [busy, setBusy] = useState(false)

  /** `forced`: changes someone changed since were undone too, and still read as conflicts in the plan. */
  function report(result: UndoResultDTO, forced = false) {
    refresh()
    const undone = (p: UndoPlanItemDTO) => p.status === 'ready' || (forced && p.status === 'conflict')
    if (result.applied) void syncPages(result.plan.filter((p) => undone(p) && p.entityType === 'page').map((p) => p.entityId), self)
    const notes = [
      result.skipped ? t('undo.skipped', { count: result.skipped }) : '',
      result.failed ? t('undo.failed', { count: result.failed }) : '',
    ].filter(Boolean)
    if (result.undone === 0 && result.failed === 0 && result.skipped === 0) return toast(t('undo.nothing'))
    if (result.undone === 0 && result.plan.length === 1 && result.plan[0]!.status === 'impossible') {
      const item = result.plan[0]!
      // Its place is in the trash: restoring it from there is where it can be decided.
      return toast.error(impossible(item), item.trashKey ? { action: { label: t('trash:openInTrash'), onClick: () => openInApp(trashHref(workspaceId, item.trashKey!)) } } : undefined)
    }
    toast.success(t('undo.done', { count: result.undone }), notes.length ? { description: notes.join(' ') } : undefined)
  }

  const impossible = (item: UndoPlanItemDTO) => t(`undo.impossible.${item.reason ?? 'refused'}`, { title: item.entityTitle })

  async function run(target: Target, conflicts: 'ask' | 'skip' | 'force') {
    setBusy(true)
    try {
      const result = await post<UndoResultDTO>('/history/undo', { ...target, conflicts })
      setAsking(null)
      report(result, conflicts === 'force')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function undoOne(entry: HistoryEntryDTO) {
    try {
      const result = await post<UndoResultDTO>('/history/undo', { ids: [entry.id] })
      if (result.applied) report(result)
      else setAsking({ target: { ids: [entry.id] }, plan: result.plan, bulk: false, name: entry.actor.name })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function undoSince(entry: HistoryEntryDTO) {
    try {
      const result = await post<UndoResultDTO>('/history/undo', { since: entry.id, dryRun: true })
      // Confirming undoes the changes shown, not whatever the agent did since: it may still be working.
      setAsking({ target: { ids: result.plan.map((p) => p.entryId) }, plan: result.plan, bulk: true, name: entry.actor.name })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function restoreVersion(entry: Pick<HistoryEntryDTO, 'id' | 'entityType' | 'entityId'>) {
    try {
      await post(`/history/${entry.id}/restore`)
      refresh()
      if (entry.entityType === 'page') await syncPages([entry.entityId], self)
      toast.success(t('undo.versionRestored'))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const dialog = asking && (
    <UndoDialog
      asking={asking}
      busy={busy}
      impossible={impossible}
      onCancel={() => setAsking(null)}
      onUndo={(conflicts) => void run(asking.target, conflicts)}
    />
  )
  return { undoOne, undoSince, restoreVersion, dialog }
}

function UndoDialog({ asking, busy, impossible, onCancel, onUndo }: { asking: Asking; busy: boolean; impossible: (item: UndoPlanItemDTO) => string; onCancel: () => void; onUndo: (conflicts: 'skip' | 'force') => void }) {
  const { t } = useTranslation(['history', 'common', 'trash'])
  const { workspaceId } = useWorkspace()
  const conflicts = asking.plan.filter((p) => p.status === 'conflict')
  const blocked = asking.plan.filter((p) => p.status === 'impossible')
  const ready = asking.plan.filter((p) => p.status === 'ready')
  const close = (open: boolean) => !open && onCancel()

  if (!asking.bulk) {
    const item = conflicts[0]!
    return (
      <Dialog
        open
        onOpenChange={close}
        title={t('undo.one.title')}
        description={item.changedBy ? t('undo.one.body', { name: item.changedBy.name }) : t('undo.one.bodyUnknown')}
        footer={
          <>
            <Button variant="ghost" onClick={onCancel}>
              {t('common:actions.cancel')}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => onUndo('force')}>
              {t('undo.one.confirm')}
            </Button>
          </>
        }
      >
        {typeof item.current === 'string' && item.current && <p className="rounded-[10px] bg-sunken px-3 py-2 text-[13px] text-ink-2">{t('undo.one.current', { value: quote(item.current) })}</p>}
      </Dialog>
    )
  }

  const count = ready.length + conflicts.length
  return (
    <Dialog
      open
      onOpenChange={close}
      width="max-w-[520px]"
      title={count ? t('undo.bulk.title', { count, name: asking.name }) : t('undo.bulk.nothing')}
      description={count ? t('undo.bulk.body') : undefined}
      footer={
        count ? (
          <>
            <Button variant="ghost" onClick={onCancel}>
              {t('common:actions.cancel')}
            </Button>
            {conflicts.length > 0 && (
              <Button variant="secondary" loading={busy} onClick={() => onUndo('force')}>
                {t('undo.bulk.force')}
              </Button>
            )}
            <Button variant="primary" loading={busy} disabled={ready.length === 0} onClick={() => onUndo('skip')}>
              {conflicts.length ? t('undo.bulk.skip', { count: ready.length }) : t('undo.bulk.confirm', { count })}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onCancel}>
            {t('common:actions.close')}
          </Button>
        )
      }
    >
      {conflicts.length > 0 && (
        <section className="mb-3">
          <h3 className="mb-1.5 text-[13px] font-medium text-ink">{t('undo.bulk.conflicts', { count: conflicts.length })}</h3>
          <ul className="flex flex-col gap-1 text-[13px] text-ink-2" aria-label={t('undo.bulk.conflictsList')}>
            {conflicts.map((c) => (
              <li key={c.entryId}>{c.changedBy ? t('undo.bulk.conflict', { title: c.entityTitle, name: c.changedBy.name }) : t('undo.bulk.conflictUnknown', { title: c.entityTitle })}</li>
            ))}
          </ul>
        </section>
      )}
      {blocked.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-[13px] font-medium text-ink">{t('undo.bulk.impossible', { count: blocked.length })}</h3>
          <ul className="flex flex-col gap-1 text-[13px] text-ink-2">
            {blocked.map((c) => (
              <li key={c.entryId}>
                {impossible(c)}
                {c.trashKey && (
                  <>
                    {' '}
                    <Link to={trashHref(workspaceId, c.trashKey)} className="font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-accent">
                      {t('trash:openInTrash')}
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Dialog>
  )
}
