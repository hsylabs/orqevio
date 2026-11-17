import type { HistoryEntryDTO, UndoPlanItemDTO, UndoResultDTO } from '@orqevio/shared'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { errorMessage, post } from '../../lib/api'
import { queryClient } from '../../lib/queries'

type Target = { ids: string[] } | { since: string }
type Asking = { target: Target; plan: UndoPlanItemDTO[]; bulk: boolean; name: string }

/** What undoing touches: refetch whatever of it is on screen. */
function refresh() {
  for (const key of ['history', 'history-entry', 'card', 'page', 'board', 'archived', 'overview', 'trash']) void queryClient.invalidateQueries({ queryKey: [key] })
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
  const { t } = useTranslation('history')
  const [asking, setAsking] = useState<Asking | null>(null)
  const [busy, setBusy] = useState(false)

  function report(result: UndoResultDTO) {
    refresh()
    const notes = [
      result.skipped ? t('undo.skipped', { count: result.skipped }) : '',
      result.failed ? t('undo.failed', { count: result.failed }) : '',
    ].filter(Boolean)
    if (result.undone === 0 && result.failed === 0 && result.skipped === 0) return toast(t('undo.nothing'))
    if (result.undone === 0 && result.plan.length === 1 && result.plan[0]!.status === 'impossible') return toast.error(impossible(result.plan[0]!))
    toast.success(t('undo.done', { count: result.undone }), notes.length ? { description: notes.join(' ') } : undefined)
  }

  const impossible = (item: UndoPlanItemDTO) => t(`undo.impossible.${item.reason ?? 'refused'}`, { title: item.entityTitle })

  async function run(target: Target, conflicts: 'ask' | 'skip' | 'force') {
    setBusy(true)
    try {
      const result = await post<UndoResultDTO>('/history/undo', { ...target, conflicts })
      setAsking(null)
      report(result)
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
      setAsking({ target: { since: entry.id }, plan: result.plan, bulk: true, name: entry.actor.name })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function restoreVersion(entry: Pick<HistoryEntryDTO, 'id'>) {
    try {
      await post(`/history/${entry.id}/restore`)
      refresh()
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
  const { t } = useTranslation(['history', 'common'])
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
              <li key={c.entryId}>{impossible(c)}</li>
            ))}
          </ul>
        </section>
      )}
    </Dialog>
  )
}
