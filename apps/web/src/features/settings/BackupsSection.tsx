import type { BackupDTO, BackupsDTO } from '@orqevio/shared'
import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Field } from '../../components/ui/Field'
import { errorMessage, post } from '../../lib/api'
import { bytes, dateTime, formatNumber, relativeTime } from '../../lib/format'
import { keys, useBackups, useUpdates } from '../../lib/queries'
import { lockVault } from '../vault/session'

const code = <code className="font-mono text-[12px] break-words text-ink" />

/** Where the backups are, as the person sees it: a folder of the server or the copy's second bucket. */
export function BackupPlace({ where }: { where: NonNullable<BackupsDTO['where']> }) {
  const { t } = useTranslation('settings')
  return (
    <Trans t={t} i18nKey={where.kind === 'folder' ? 'backups.whereFolder' : 'backups.whereBucket'} values={{ name: where.name }} components={{ code }} />
  )
}

/**
 * Settings → backups: one a day by itself, the last ones kept apart from the copy's data
 * (a folder on Node and Docker, a second R2 bucket on Cloudflare), and any of them can be
 * put back. Restoring is confirmed with the access key and by typing the copy's name.
 */
export function BackupsSection() {
  const { t } = useTranslation(['settings', 'common'])
  const queryClient = useQueryClient()
  const backups = useBackups()
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState<BackupDTO | null>(null)

  async function backUpNow() {
    setBusy(true)
    try {
      await post('/backups')
      await queryClient.invalidateQueries({ queryKey: keys.backups })
      toast.success(t('backups.made'))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const data = backups.data
  if (!data) return null
  if (!data.where) return <p className="text-[13px] leading-relaxed text-ink-3">{t('backups.off')}</p>
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] leading-relaxed text-ink-2">
        <BackupPlace where={data.where} />
      </p>
      <Button variant="secondary" className="self-start" loading={busy} onClick={backUpNow}>
        {t('backups.now')}
      </Button>
      {data.backups.length === 0 ? (
        <p className="text-[13px] text-ink-3">{t('backups.none')}</p>
      ) : (
        <ul aria-label={t('backups.list')} className="flex flex-col divide-y divide-line rounded-[12px] border border-line">
          {data.backups.map((backup) => (
            <li key={backup.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium first-letter:uppercase">{dateTime(backup.createdAt)}</p>
                <p className="mt-0.5 text-[12.5px] text-ink-3">
                  {t(`backups.kind.${backup.kind}`)} · {relativeTime(backup.createdAt)} · {bytes(backup.bytes)}
                </p>
                <p className="mt-0.5 text-[12.5px] text-ink-3">
                  {t('backups.contents', {
                    cards: formatNumber(backup.counts.cards),
                    pages: formatNumber(backup.counts.pages),
                    files: formatNumber(backup.files),
                    count: backup.counts.cards,
                  })}
                </p>
                {backup.missingFiles > 0 && <p className="mt-0.5 text-[12.5px] text-danger">{t('backups.missingFiles', { count: backup.missingFiles })}</p>}
                {backup.newer && <p className="mt-0.5 text-[12.5px] text-ink-3">{t('backups.newer', { version: backup.version })}</p>}
              </div>
              <Button variant="ghost" size="sm" disabled={backup.newer} onClick={() => setRestoring(backup)}>
                {t('backups.restore')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[12.5px] leading-relaxed text-ink-3">{t('backups.keep', { count: data.keep })}</p>
      <RestoreDialog backup={restoring} onClose={() => setRestoring(null)} />
    </div>
  )
}

function RestoreDialog({ backup, onClose }: { backup: BackupDTO | null; onClose: () => void }) {
  const { t } = useTranslation(['settings', 'common'])
  const updates = useUpdates()
  const [accessKey, setAccessKey] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  // The Worker's name on Cloudflare; elsewhere, the address the copy is reached at.
  const name = updates.data?.copyName ?? window.location.hostname

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!backup) return
    setBusy(true)
    try {
      await post(`/backups/${backup.id}/restore`, { accessKey })
      // Everything changed underneath: start again from the restored copy, with the new session.
      lockVault()
      window.location.assign('/')
    } catch (error) {
      toast.error(errorMessage(error))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={backup !== null}
      onOpenChange={(open) => {
        if (open) return
        setAccessKey('')
        setTyped('')
        onClose()
      }}
      title={t('backups.restoreTitle')}
      description={backup ? t('backups.restoreDescription', { date: dateTime(backup.createdAt) }) : undefined}
    >
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13px] leading-relaxed text-ink-2">
          <li>{t('backups.restoreLoses')}</li>
          <li>{t('backups.restoreSafety')}</li>
          <li>{t('backups.restoreSessions')}</li>
        </ul>
        <Field label={t('backups.accessKey')} type="password" autoComplete="current-password" spellCheck={false} className="[&_input]:font-mono" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} autoFocus />
        <Field label={t('backups.typeName', { name })} autoComplete="off" spellCheck={false} className="[&_input]:font-mono" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" variant="danger" loading={busy} disabled={!accessKey || typed.trim() !== name}>
            {t('backups.restoreConfirm')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
