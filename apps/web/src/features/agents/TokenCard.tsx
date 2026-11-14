import type { TokenDTO } from '@orqevio/shared'
import { levelFromScopes } from '@orqevio/shared'
import { Clock, LockKeyhole, Trash as TrashIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { useConfirm } from '../../components/ui/confirm'
import { del, errorMessage } from '../../lib/api'
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

/** An agent's access: its name, permissions and dates, with optional actions. */
export function TokenCard({ token, onRevoke, onShowActivity, inactive }: { token: TokenDTO; onRevoke?: () => void; onShowActivity?: () => void; inactive?: boolean }) {
  const { t } = useTranslation('agents')
  const tasks = levelFromScopes(token.scopes, 'tasks')
  const docs = levelFromScopes(token.scopes, 'docs')
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
        <span className="inline-flex h-6 items-center gap-1 rounded-full bg-sunken px-2 text-[11.5px] text-ink-3">
          <LockKeyhole className="size-3" /> {t('token.vaultNever')}
        </span>
        {idle !== null && (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-sunken px-2 text-[11.5px] font-medium text-warn">
            <Clock className="size-3" /> {t('token.idle', { days: idle })}
          </span>
        )}
      </div>
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
