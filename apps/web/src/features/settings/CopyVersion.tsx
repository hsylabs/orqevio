import type { UpdateStatusDTO } from '@orqevio/shared'
import { ArrowUpRight, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CopyButton } from '../../components/ui/CopyButton'
import { useUpdates } from '../../lib/queries'

/** How each kind of copy updates (see "Updates" in the README); `how` names its explanation in the catalog. */
function howToUpdate(status: UpdateStatusDTO): { how: 'cli' | 'button' | 'docker' | 'source'; command?: string } {
  switch (status.install) {
    case 'cli':
    case 'cloudflare': {
      const name = status.copyName && status.copyName !== 'orqevio' ? ` --name ${status.copyName}` : ''
      return { how: 'cli', command: `npx create-orqevio@latest update${name}` }
    }
    case 'button':
      return { how: 'button' }
    case 'docker':
      return { how: 'docker', command: 'docker compose pull && docker compose up -d' }
    default:
      return { how: 'source', command: 'git pull && pnpm install && pnpm build' }
  }
}

/** Version of this copy and, when there is one, the newer version with how to install it. */
export function CopyVersion() {
  const { t } = useTranslation('settings')
  const { data: status } = useUpdates()
  if (!status) return null
  const update = howToUpdate(status)
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px]">
        Orqevio <span className="font-mono text-[13px]">{status.current}</span>
        {status.latest && !status.updateAvailable && <span className="text-ink-3"> · {t('version.upToDate')}</span>}
      </p>
      {status.updateAvailable && (
        <div role="status" className="flex flex-col gap-3 rounded-[12px] border border-accent/40 bg-[color-mix(in_oklab,var(--accent)_8%,var(--sheet))] p-4">
          <p className="flex items-center gap-2 text-[14px] font-medium">
            <Sparkles className="size-4 text-accent" />
            {t('version.available', { version: status.latest ?? '' })}
          </p>
          <p className="text-[13px] leading-relaxed text-ink-2">{t(`version.how.${update.how}`)}</p>
          {update.command && (
            <div className="flex items-center gap-2 rounded-[10px] border border-line bg-surface py-1 pr-1 pl-3">
              <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{update.command}</code>
              <CopyButton value={update.command} label={t('version.copy')} message={t('version.copied')} />
            </div>
          )}
          <p className="text-[12.5px] text-ink-3">{t('version.kept')}</p>
          {status.releaseUrl && (
            <a href={status.releaseUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 self-start text-[13px] font-medium text-accent hover:underline">
              {t('version.releaseNotes')}
              <ArrowUpRight className="size-3.5" />
            </a>
          )}
        </div>
      )}
    </div>
  )
}
