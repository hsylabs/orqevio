import type { ActivityDTO } from '@orqevio/shared'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { activityDetail, activityHref, activityKey, activityTarget } from '../lib/activity'
import { relativeTime } from '../lib/format'
import { Avatar } from './ui/Avatar'

/** `showSummary={false}` speaks of the card being viewed ("created this card"). */
export function ActivityList({ items, workspaceId, compact, showSummary = true }: { items: ActivityDTO[]; workspaceId: string; compact?: boolean; showSummary?: boolean }) {
  const { t } = useTranslation('activity')
  return (
    <ol className="relative flex flex-col">
      {items.map((a, i) => {
        const href = activityHref(workspaceId, a)
        const detail = activityDetail(a)
        const target = href ? (
          <Link to={href} className="font-medium text-ink hover:underline hover:decoration-accent hover:underline-offset-2" />
        ) : (
          <span className="font-medium text-ink" />
        )
        return (
          <li key={a.id} className="relative flex gap-3 pb-3.5 last:pb-0">
            {i < items.length - 1 && <span className="absolute top-7 bottom-0 left-[11px] w-px bg-line" aria-hidden="true" />}
            <Avatar name={a.actor.name} kind={a.actor.kind} size={compact ? 22 : 24} className="relative z-[1] mt-px" />
            <div className="min-w-0 flex-1 text-[13px] leading-snug text-ink-2">
              <Trans
                t={t}
                i18nKey={activityKey(a.action, !showSummary)}
                values={{ actor: a.actor.name, target: activityTarget(a) }}
                components={{ actor: <span className={a.actor.kind === 'agent' ? 'font-medium text-agent' : 'font-medium text-ink'} />, target }}
              />
              {detail && <span className="text-ink-3"> · {detail}</span>}
              <span className="mt-0.5 block text-[11.5px] text-ink-3">
                <time dateTime={a.createdAt}>{relativeTime(a.createdAt)}</time>
                {a.actor.kind === 'agent' && ` · ${t('viaMcp')}`}
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
