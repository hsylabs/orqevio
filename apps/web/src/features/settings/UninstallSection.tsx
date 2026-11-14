import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Field } from '../../components/ui/Field'
import { errorMessage, post } from '../../lib/api'
import { useUpdates } from '../../lib/queries'
import { lockVault } from '../vault/session'

const LOSSES = ['data', 'files', 'vault', 'agents'] as const

/**
 * Settings → uninstall: deletes every piece of data, attachments included, and
 * leaves the copy unusable; the sign-in page then shows how to remove the copy
 * itself. Confirmed with the access key and by typing the copy's name.
 */
export function UninstallSection() {
  const { t } = useTranslation(['settings', 'common'])
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const updates = useUpdates()
  const [open, setOpen] = useState(false)
  const [accessKey, setAccessKey] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  // The Worker's name on Cloudflare; elsewhere, the address the copy is reached at.
  const name = updates.data?.copyName ?? window.location.hostname

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await post('/account/uninstall', { accessKey })
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
          <Field label={t('uninstall.accessKey')} type="password" autoComplete="current-password" spellCheck={false} className="[&_input]:font-mono" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} autoFocus />
          <Field label={t('uninstall.typeName', { name })} autoComplete="off" spellCheck={false} className="[&_input]:font-mono" value={typed} onChange={(e) => setTyped(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" variant="danger" loading={busy} disabled={!accessKey || typed.trim() !== name}>
              {t('uninstall.confirm')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  )
}
