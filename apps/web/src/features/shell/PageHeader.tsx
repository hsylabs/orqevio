import { Ellipsis, PanelLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from '../../components/ui/Menu'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'
import { useWorkspace } from './workspace'

export interface Crumb {
  label: ReactNode
  to?: string
}

/** Beyond this many, the crumbs between the first one and the last three fold into a menu. */
const MAX_CRUMBS = 5

export function PageHeader({ crumbs, actions, className }: { crumbs: Crumb[]; actions?: ReactNode; className?: string }) {
  const { t } = useTranslation('shell')
  const { sidebarOpen, toggleSidebar } = useWorkspace()
  const navigate = useNavigate()
  const folded = crumbs.length > MAX_CRUMBS ? crumbs.slice(1, -3) : []
  const shown: Array<Crumb | 'folded'> = folded.length ? [crumbs[0]!, 'folded', ...crumbs.slice(-3)] : crumbs
  return (
    <header className={cn('flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-3 sm:px-4', className)}>
      <div className={cn(sidebarOpen && 'min-[900px]:hidden')}>
        <Tooltip label={sidebarOpen ? t('header.hideSidebar') : t('header.showSidebar')} keys={['mod', '\\']}>
          <button type="button" onClick={toggleSidebar} className="grid size-8 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink" aria-label={t('header.toggleSidebar')} aria-expanded={sidebarOpen}>
            <PanelLeft className="size-[17px]" />
          </button>
        </Tooltip>
      </div>
      <nav aria-label={t('header.breadcrumb')} className="flex min-w-0 flex-1 items-center gap-1 text-[13px]">
        {shown.map((c, i) => {
          if (c === 'folded') {
            return (
              <span key="folded" className="flex shrink-0 items-center gap-1 max-sm:hidden">
                <MenuRoot>
                  <MenuTrigger asChild>
                    <button type="button" aria-label={t('header.moreCrumbs')} className="grid h-7 w-7 place-items-center rounded-[6px] text-ink-3 hover:bg-hover hover:text-ink data-[state=open]:bg-hover">
                      <Ellipsis className="size-4" />
                    </button>
                  </MenuTrigger>
                  <MenuContent align="start" className="max-h-[60vh] max-w-[320px] overflow-y-auto">
                    {folded.map((f, k) => (
                      <MenuItem key={k} onSelect={() => f.to && navigate(f.to)}>
                        <span className="block truncate">{f.label}</span>
                      </MenuItem>
                    ))}
                  </MenuContent>
                </MenuRoot>
                <span className="text-ink-4">/</span>
              </span>
            )
          }
          const last = i === shown.length - 1
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
