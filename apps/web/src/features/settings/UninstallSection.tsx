import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Field } from '../../components/ui/Field'
import { errorMessage, post } from '../../lib/api'
import { cn } from '../../lib/cn'
import { useBackups, useUpdates } from '../../lib/queries'
import { BackupPlace } from './BackupsSection'
import { lockVault } from '../vault/session'

const LOSSES = ['data', 'files', 'vault', 'agents'] as const

/**
 * Settings → uninstall: deletes every piece of data, attachments included, and
 * leaves the copy unusable; the sign-in page then shows how to remove the copy
 * itself. Confirmed with the access key and by typing the copy's name. Its backups, kept
 * apart from its data, go too only if the person chooses so: it is asked every time.
 */
export function UninstallSection() {
  const { t } = useTranslation(['settings', 'common'])
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const updates = useUpdates()
  const backups = useBackups()
  const where = backups.data?.where ?? null
  const [deleteBackups, setDeleteBackups] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)
  const [accessKey, setAccessKey] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  // The Worker's name on Cloudflare; elsewhere, the address the copy is reached at.
  const name = updates.data?.copyName ?? window.location.hostname
  // Installed with the command, the installer can also do both steps at once, from the person's computer.
  const copyName = updates.data?.copyName
  const oneCommand = updates.data?.install === 'cli' ? `npx create-orqevio@latest uninstall${copyName && copyName !== 'orqevio' ? ` --name ${copyName}` : ''}` : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await post('/account/uninstall', { accessKey, deleteBackups: where ? deleteBackups === true : false })
      lockVault()
      queryClient.clear()
      navigate('/login', { replace: true })
    } catch (error) {
      toast.error(errorMessage(error))
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setOpen(true)}>
        {t('uninstall.action')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={t('uninstall.title')} description={t('uninstall.confirmDescription')}>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13px] leading-relaxed text-ink-2">
            {LOSSES.map((loss) => (
              <li key={loss}>{t(`uninstall.loses.${loss}`)}</li>
            ))}
          </ul>
          <p className="text-[13px] leading-relaxed text-ink-3">{t('uninstall.afterwards')}</p>
          {oneCommand && (
            <p className="text-[13px] leading-relaxed text-ink-3">
              <Trans t={t} i18nKey="uninstall.oneCommand" values={{ command: oneCommand }} components={{ code: <code className="font-mono text-[12px] break-words text-ink" /> }} />
            </p>
          )}
          {where && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-[13px] font-medium text-ink">{t('uninstall.backups.legend')}</legend>
              <p className="text-[12.5px] leading-relaxed text-ink-3">
                <BackupPlace where={where} />
              </p>
              {(['keep', 'delete'] as const).map((option) => {
                const chosen = deleteBackups === (option === 'delete')
                return (
                  <label key={option} className={cn('flex cursor-pointer items-start gap-3 rounded-[10px] border bg-sheet px-3 py-2.5', chosen ? 'border-accent' : 'border-line')}>
                    <input type="radio" name="uninstall-backups" value={option} checked={chosen} onChange={() => setDeleteBackups(option === 'delete')} className="mt-1 size-4 accent-[var(--accent)]" />
                    <span>
                      <span className="block text-[13px] font-medium text-ink">{t(`uninstall.backups.${option}.label`)}</span>
                      <span className="block text-[12.5px] text-ink-3">{t(`uninstall.backups.${option}.hint`)}</span>
                    </span>
                  </label>
                )
              })}
            </fieldset>
          )}
          <Field label={t('uninstall.accessKey')} type="password" autoComplete="current-password" spellCheck={false} className="[&_input]:font-mono" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} autoFocus />
          <Field label={t('uninstall.typeName', { name })} autoComplete="off" spellCheck={false} className="[&_input]:font-mono" value={typed} onChange={(e) => setTyped(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" variant="danger" loading={busy} disabled={!accessKey || typed.trim() !== name || backups.isPending || (where !== null && deleteBackups === null)}>
              {t('uninstall.confirm')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  )
}
