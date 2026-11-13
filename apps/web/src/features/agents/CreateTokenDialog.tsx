import type { AccessLevel, CreatedTokenDTO } from '@orqevio/shared'
import { scopesFromLevels } from '@orqevio/shared'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { CopyButton } from '../../components/ui/CopyButton'
import { Dialog } from '../../components/ui/Dialog'
import { Field } from '../../components/ui/Field'
import { Segmented } from '../../components/ui/Segmented'
import { errorMessage, post } from '../../lib/api'
import { keys, queryClient } from '../../lib/queries'
import { useWorkspace } from '../shell/workspace'
import { AccessRows } from './AccessRows'
import { ConnectKit } from './ConnectKit'

/** How long a new token lasts, in days. */
const EXPIRIES = ['30', '90', '365', 'never'] as const

export function CreateTokenDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation(['agents', 'common'])
  const { workspaceId, me } = useWorkspace()
  const [name, setName] = useState('')
  const [tasks, setTasks] = useState<AccessLevel>('write')
  const [docs, setDocs] = useState<AccessLevel>('read')
  const [expiry, setExpiry] = useState<(typeof EXPIRIES)[number]>('90')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<CreatedTokenDTO | null>(null)
  const workspace = me.workspaces.find((w) => w.id === workspaceId)
  const scopes = scopesFromLevels({ tasks, docs })

  function close(o: boolean) {
    onOpenChange(o)
    if (!o) {
      setTimeout(() => {
        setCreated(null)
        setName('')
      }, 300)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || scopes.length === 0) return
    setBusy(true)
    try {
      const token = await post<CreatedTokenDTO>('/tokens', {
        name: name.trim(),
        workspaceId,
        scopes,
        expiresInDays: expiry === 'never' ? null : Number(expiry),
      })
      setCreated(token)
      await queryClient.invalidateQueries({ queryKey: keys.tokens })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    return (
      <Dialog open={open} onOpenChange={close} title={t('created.title', { name: created.name })} description={t('created.description')} width="max-w-[640px]">
        <div className="flex items-center gap-2 rounded-[12px] border border-line bg-sunken py-2 pr-2 pl-3.5">
          <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{created.token}</code>
          <CopyButton value={created.token} label={t('created.copy')} message={t('created.copied')} />
        </div>
        <div className="mt-5">
          <ConnectKit token={created.token} />
        </div>
        <div className="mt-5 flex justify-end">
          <Button variant="primary" onClick={() => close(false)}>
            {t('created.done')}
          </Button>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={t('connect')}
      description={workspace ? t('create.description', { workspace: workspace.name }) : t('create.descriptionFallback')}
      width="max-w-[520px]"
    >
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Field label={t('create.name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('create.namePlaceholder')} autoFocus maxLength={60} />
        <AccessRows tasks={tasks} docs={docs} onTasks={setTasks} onDocs={setDocs} />
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium text-ink-2">{t('create.expiry')}</span>
          <Segmented size="sm" label={t('create.expiry')} value={expiry} onChange={setExpiry} options={EXPIRIES.map((value) => ({ value, label: t(`create.expiries.${value}`) }))} />
        </div>
        {scopes.length === 0 && <p className="text-[12.5px] text-danger">{t('access.atLeastOne')}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => close(false)}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" variant="agent" loading={busy} disabled={!name.trim() || scopes.length === 0}>
            {t('create.submit')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
