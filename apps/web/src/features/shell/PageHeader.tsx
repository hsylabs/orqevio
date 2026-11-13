import { PanelLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'
import { useWorkspace } from './workspace'

export interface Crumb {
  label: ReactNode
  to?: string
}

export function PageHeader({ crumbs, actions, className }: { crumbs: Crumb[]; actions?: ReactNode; className?: string }) {
  const { t } = useTranslation('shell')
  const { sidebarOpen, toggleSidebar } = useWorkspace()
  return (
    <header className={cn('flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-3 sm:px-4', className)}>
      <div className={cn(sidebarOpen && 'min-[900px]:hidden')}>
        <Tooltip label={sidebarOpen ? t('header.hideSidebar') : t('header.showSidebar')} keys={['mod', '\\']}>
          <button type="button" onClick={toggleSidebar} className="grid size-8 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink" aria-label={t('header.toggleSidebar')}>
            <PanelLeft className="size-[17px]" />
          </button>
        </Tooltip>
      </div>
      <nav aria-label={t('header.breadcrumb')} className="flex min-w-0 flex-1 items-center gap-1 text-[13px]">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          return (
            <span key={i} className={cn('flex min-w-0 items-center gap-1', !last && 'max-sm:hidden')}>
              {c.to && !last ? (
                <Link to={c.to} className="truncate rounded-[6px] px-1.5 py-1 text-ink-3 hover:bg-hover hover:text-ink">
                  {c.label}
                </Link>
              ) : (
                <span className={cn('truncate px-1.5 py-1', last ? 'font-medium text-ink' : 'text-ink-3')} aria-current={last ? 'page' : undefined}>
                  {c.label}
                </span>
              )}
              {!last && <span className="text-ink-4">/</span>}
            </span>
          )
        })}
      </nav>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  )
}
