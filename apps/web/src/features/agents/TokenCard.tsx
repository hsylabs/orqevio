import type { TokenDTO } from '@orqevio/shared'
import { levelFromScopes } from '@orqevio/shared'
import { Clock, LockKeyhole, Trash as TrashIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useState } from 'react'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Checkbox } from '../../components/ui/Checkbox'
import { useConfirm } from '../../components/ui/confirm'
import { del, errorMessage, patch } from '../../lib/api'
import { cn } from '../../lib/cn'
import { relativeTime, shortDate } from '../../lib/format'
import { keys, queryClient } from '../../lib/queries'
import { destination } from '../oauth/destination'

/** Revokes an agent's access after asking, as in Agents. */
export function useRevokeToken() {
  const { t } = useTranslation('agents')
  const confirm = useConfirm()
  return async function revoke(token: TokenDTO) {
    const ok = await confirm({
      title: t('revoke.title', { name: token.name }),
      description: t('revoke.description'),
      confirmLabel: t('revoke.confirm'),
      danger: true,
    })
    if (!ok) return
    try {
      await del(`/tokens/${token.id}`)
      await queryClient.invalidateQueries({ queryKey: keys.tokens })
      toast.success(t('revoke.done'))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
}

/** Lets an agent delete and move things, or stops it: tokens from before 1.1.0 don't have it. */
function OrganizeToggle({ token }: { token: TokenDTO }) {
  const { t } = useTranslation('agents')
  const [busy, setBusy] = useState(false)
  const on = token.scopes.includes('organize')
  async function toggle(next: boolean) {
    setBusy(true)
    try {
      await patch(`/tokens/${token.id}`, { organize: next })
      await queryClient.invalidateQueries({ queryKey: keys.tokens })
      toast.success(next ? t('token.organize.on', { name: token.name }) : t('token.organize.off', { name: token.name }))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-[12px] bg-sunken px-3 py-2">
      <span>
        <span className="block text-[12.5px] font-medium text-ink-2">{t('access.organize.label')}</span>
        <span className="block text-[11.5px] text-ink-3">{t('token.organize.hint')}</span>
      </span>
      <Checkbox checked={on} onChange={(next) => void toggle(next)} label={t('access.organize.label')} disabled={busy} />
    </div>
  )
}

/** An agent's access: its name, permissions and dates, with optional actions. */
export function TokenCard({ token, onRevoke, onShowActivity, inactive, editable }: { token: TokenDTO; onRevoke?: () => void; onShowActivity?: () => void; inactive?: boolean; editable?: boolean }) {
  const { t } = useTranslation('agents')
  const tasks = levelFromScopes(token.scopes, 'tasks')
  const docs = levelFromScopes(token.scopes, 'docs')
  const writes = tasks === 'write' || docs === 'write'
  const back = token.oauth ? destination(token.oauth.redirectUri) : null
  const idle = token.revokedAt ? null : idleDays(token.lastUsedAt ?? token.createdAt)
  return (
    <article className={cn('rounded-[16px] border border-line bg-surface p-4 shadow-sm', inactive && 'opacity-60')}>
      <div className="flex items-start gap-3">
        <Avatar name={token.name} kind="agent" size={36} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14.5px] font-semibold">{token.name}</h3>
          {back ? (
            <p className="truncate text-[11.5px] text-ink-3">{t(`token.oauth.${back.kind}`, { name: back.name })}</p>
          ) : (
            <p className="font-mono text-[11.5px] text-ink-3">{token.prefix}…</p>
          )}
        </div>
        {onRevoke && (
          <Button variant="ghost" size="xs" icon={<TrashIcon />} onClick={onRevoke} className="hover:text-danger">
            {t('revoke.action')}
          </Button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <ScopePill area="tasks" level={tasks} />
        <ScopePill area="docs" level={docs} />
        {token.scopes.includes('organize') && <span className="inline-flex h-6 items-center rounded-full bg-agent px-2 text-[11.5px] font-medium text-agent-ink">{t('token.organize.pill')}</span>}
        <span className="inline-flex h-6 items-center gap-1 rounded-full bg-sunken px-2 text-[11.5px] text-ink-3">
          <LockKeyhole className="size-3" /> {t('token.vaultNever')}
        </span>
        {idle !== null && (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-sunken px-2 text-[11.5px] font-medium text-warn">
            <Clock className="size-3" /> {t('token.idle', { days: idle })}
          </span>
        )}
      </div>
      {editable && writes && !token.revokedAt && <OrganizeToggle token={token} />}
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-[11.5px]">
        <div>
          <dt className="text-ink-3">{t('token.lastUsed')}</dt>
          <dd className="text-ink-2">{token.lastUsedAt ? relativeTime(token.lastUsedAt) : t('token.never')}</dd>
        </div>
        <div>
          <dt className="text-ink-3">{t('token.created')}</dt>
          <dd className="text-ink-2">{shortDate(token.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-ink-3">{token.revokedAt ? t('token.revoked') : token.oauth ? t('token.expiresUnused') : t('token.expires')}</dt>
          <dd className="text-ink-2">{token.revokedAt ? shortDate(token.revokedAt) : token.expiresAt ? shortDate(token.expiresAt) : t('token.never')}</dd>
        </div>
      </dl>
      {onShowActivity && (
        <button type="button" onClick={onShowActivity} className="mt-3 text-[12px] font-medium text-agent hover:underline">
          {t('token.showActivity')}
        </button>
      )}
    </article>
  )
}

/** Whole days since an access was last used (or created, if never), from a week on: below that, null. */
export function idleDays(since: string, now = Date.now()) {
  const days = Math.floor((now - new Date(since).getTime()) / 86_400_000)
  return days >= IDLE_DAYS ? days : null
}

const IDLE_DAYS = 7

function ScopePill({ area, level }: { area: 'tasks' | 'docs'; level: 'none' | 'read' | 'write' }) {
  const { t } = useTranslation('agents')
  return (
    <span className={cn('inline-flex h-6 items-center rounded-full px-2 text-[11.5px] font-medium', level === 'none' ? 'bg-sunken text-ink-3' : level === 'read' ? 'bg-agent-soft text-agent' : 'bg-agent text-agent-ink')}>
      {t(`token.access.${area}.${level}`)}
    </span>
  )
}
