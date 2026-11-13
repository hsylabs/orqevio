import type { PageNodeDTO, ProjectTreeDTO } from '@orqevio/shared'
import { useQueryClient } from '@tanstack/react-query'
import {
  Bot,
  Check,
  ChevronRight,
  ChevronsUpDown,
  Ellipsis,
  FileText,
  House,
  LockKeyhole,
  LogOut,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings,
  SquareKanban,
  Sun,
  Trash,
  Pencil,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { LogoMark } from '../../components/Logo'
import { Avatar } from '../../components/ui/Avatar'
import { Kbd } from '../../components/ui/Kbd'
import { MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuRoot, MenuSeparator, MenuTrigger } from '../../components/ui/Menu'
import { usePrompt } from '../../components/ui/prompt'
import { Tooltip } from '../../components/ui/Tooltip'
import { errorMessage, patch, post } from '../../lib/api'
import { cn } from '../../lib/cn'
import { keys, useUpdates } from '../../lib/queries'
import { useAgentLive } from '../../lib/realtime'
import { applyTheme, localPref, setLocalPref } from '../../lib/theme'
import { lockVault, useVaultLocked } from '../vault/session'
import { useStructureActions } from './actions'
import { ProjectSettingsDialog } from './ProjectSettingsDialog'
import { useWorkspace } from './workspace'

export function Sidebar() {
  const { t } = useTranslation(['shell', 'common'])
  const { workspaceId, overview, openPalette, openNewProject } = useWorkspace()
  const agentLive = useAgentLive()
  const vaultLocked = useVaultLocked()
  const base = `/w/${workspaceId}`

  return (
    <nav aria-label={t('nav.label')} className="flex h-full flex-col px-2.5 pt-2.5 pb-2">
      <WorkspaceSwitcher live={agentLive} />

      <button
        type="button"
        onClick={openPalette}
        className="mt-2 flex h-8.5 items-center gap-2 rounded-[9px] border border-line bg-surface/70 px-2.5 text-[13px] text-ink-3 shadow-sm transition-colors hover:border-line-strong hover:text-ink-2"
      >
        <Search className="size-[15px]" />
        <span className="flex-1 text-left">{t('nav.search')}</span>
        <Kbd keys={['mod', 'K']} />
      </button>

      <div className="mt-3 flex flex-col gap-px">
        <NavItem to={base} end icon={<House />}>
          {t('nav.home')}
        </NavItem>
        <NavItem to={`${base}/vault`} icon={<LockKeyhole />} trailing={<VaultState locked={vaultLocked} />}>
          {t('nav.vault')}
        </NavItem>
        <NavItem to={`${base}/agents`} icon={<Bot />} trailing={agentLive ? <span className="live-dot mr-1" aria-label={t('nav.agentLive')} /> : null}>
          {t('nav.agents')}
        </NavItem>
      </div>

      <div className="mt-5 flex items-center justify-between pr-1 pl-2.5">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase">{t('nav.projects')}</span>
        <Tooltip label={t('nav.newProject')}>
          <button type="button" onClick={openNewProject} aria-label={t('nav.newProject')} className="grid size-6 place-items-center rounded-[7px] text-ink-3 hover:bg-hover hover:text-ink">
            <Plus className="size-[15px]" />
          </button>
        </Tooltip>
      </div>

      <div className="-mx-1 mt-1 min-h-0 flex-1 overflow-y-auto px-1 pb-4">
        {overview ? (
          overview.projects.length ? (
            overview.projects.map((p) => <ProjectItem key={p.id} project={p} />)
          ) : (
            <button
              type="button"
              onClick={openNewProject}
              className="mt-1 w-full rounded-[10px] border border-dashed border-line-strong px-3 py-4 text-left text-[12.5px] text-ink-3 transition-colors hover:border-ink-3 hover:text-ink-2"
            >
              <span className="block font-medium text-ink-2">{t('nav.firstProject.title')}</span>
              {t('nav.firstProject.body')}
            </button>
          )
        ) : (
          <div className="flex flex-col gap-2 px-2 pt-2">
            <div className="skeleton h-5 w-3/4" />
            <div className="skeleton h-5 w-2/3" />
            <div className="skeleton h-5 w-4/5" />
          </div>
        )}
      </div>

      <UserMenu />
    </nav>
  )
}

function VaultState({ locked }: { locked: boolean }) {
  const { t } = useTranslation(['shell', 'common'])
  return (
    <span
      className={cn('mr-1 size-1.5 rounded-full transition-colors', locked ? 'bg-ink-4' : 'bg-ok')}
      aria-label={locked ? t('nav.vaultLocked') : t('nav.vaultUnlocked')}
      title={locked ? t('nav.vaultLocked') : t('nav.vaultUnlocked')}
    />
  )
}

function NavItem({ to, end, icon, children, trailing }: { to: string; end?: boolean; icon: ReactNode; children: ReactNode; trailing?: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'group relative flex h-8 items-center gap-2.5 rounded-[8px] px-2.5 text-[13.5px] transition-colors [&>svg]:size-[16px] [&>svg]:shrink-0',
          isActive ? 'bg-surface font-medium text-ink shadow-sm [&>svg]:text-accent' : 'text-ink-2 hover:bg-hover hover:text-ink [&>svg]:text-ink-3',
        )
      }
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {trailing}
    </NavLink>
  )
}

function WorkspaceSwitcher({ live }: { live: boolean }) {
  const { t } = useTranslation(['shell', 'common'])
  const { me, workspaceId } = useWorkspace()
  const navigate = useNavigate()
  const prompt = usePrompt()
  const queryClient = useQueryClient()
  const current = me.workspaces.find((w) => w.id === workspaceId)

  async function createWorkspace() {
    const name = await prompt({ title: t('workspace.new'), description: t('workspace.newDescription'), label: t('workspace.name'), confirmLabel: t('workspace.create'), maxLength: 60 })
    if (!name) return
    try {
      const w = await post<{ id: string }>('/workspaces', { name })
      await queryClient.invalidateQueries({ queryKey: keys.me })
      navigate(`/w/${w.id}`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <button type="button" className="flex h-10 items-center gap-2.5 rounded-[10px] px-1.5 text-left transition-colors hover:bg-hover data-[state=open]:bg-hover">
          <LogoMark size={28} live={live} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] leading-tight font-semibold">{current?.name ?? t('workspace.fallback')}</span>
            <span className="block text-[11.5px] leading-tight text-ink-3">Orqevio</span>
          </span>
          <ChevronsUpDown className="size-[14px] text-ink-3" />
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="w-[240px]">
        <MenuLabel>{t('workspace.heading')}</MenuLabel>
        {me.workspaces.map((w) => (
          <MenuItem key={w.id} onSelect={() => navigate(`/w/${w.id}`)} icon={<span className="glyph c-slate size-5 text-[11px]">{w.name[0]?.toUpperCase()}</span>}>
            <span className="flex items-center justify-between gap-2">
              <span className="truncate">{w.name}</span>
              {w.id === workspaceId && <Check className="size-[14px] text-accent" />}
            </span>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon={<Plus />} onSelect={createWorkspace}>
          {t('workspace.new')}
        </MenuItem>
        <MenuItem icon={<Settings />} onSelect={() => navigate(`/w/${workspaceId}/settings`)}>
          {t('workspace.settings')}
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  )
}

function useExpanded(id: string, initial: boolean) {
  const [open, setOpen] = useState<boolean>(() => localPref<Record<string, boolean>>('expanded', {})[id] ?? initial)
  const toggle = (value?: boolean) => {
    const next = value ?? !open
    setOpen(next)
    const all = localPref<Record<string, boolean>>('expanded', {})
    all[id] = next
    setLocalPref('expanded', all)
  }
  return [open, toggle] as const
}

function ProjectItem({ project }: { project: ProjectTreeDTO }) {
  const { t } = useTranslation(['shell', 'common'])
  const { workspaceId } = useWorkspace()
  const location = useLocation()
  const actions = useStructureActions(workspaceId)
  const [open, toggle] = useExpanded(project.id, true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const base = `/w/${workspaceId}`
  const roots = project.pages.filter((p) => p.parentId === null)
  const active = location.pathname === `${base}/p/${project.id}`

  return (
    <div className="mt-0.5">
      <div className={cn('group flex h-8 items-center gap-1 rounded-[8px] pr-1 transition-colors', active ? 'bg-surface shadow-sm' : 'hover:bg-hover')}>
        <button
          type="button"
          onClick={() => toggle()}
          aria-label={open ? t('project.collapse', { name: project.name }) : t('project.expand', { name: project.name })}
          aria-expanded={open}
          className="grid size-6 shrink-0 place-items-center rounded-[6px] text-ink-4 hover:text-ink"
        >
          <ChevronRight className={cn('size-[13px] transition-transform duration-200', open && 'rotate-90')} />
        </button>
        <NavLink to={`${base}/p/${project.id}`} className="flex min-w-0 flex-1 items-center gap-2 py-1 text-[13.5px]">
          <span className={cn('glyph size-[18px] text-[10.5px]', `c-${project.color}`)}>{project.name[0]?.toUpperCase()}</span>
          <span className={cn('truncate', active ? 'font-medium text-ink' : 'text-ink-2 group-hover:text-ink')}>{project.name}</span>
        </NavLink>
        <MenuRoot>
          <MenuTrigger asChild>
            <button type="button" aria-label={t('project.actions', { name: project.name })} className="grid size-6 place-items-center rounded-[6px] text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-press hover:text-ink focus-visible:opacity-100 data-[state=open]:opacity-100">
              <Ellipsis className="size-[15px]" />
            </button>
          </MenuTrigger>
          <MenuContent align="start">
            <MenuItem icon={<SquareKanban />} onSelect={() => void actions.createBoard(project.id)}>
              {t('project.newBoard')}
            </MenuItem>
            <MenuItem icon={<FileText />} onSelect={() => void actions.createPage(project.id)}>
              {t('project.newPage')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Pencil />} onSelect={() => setSettingsOpen(true)}>
              {t('project.rename')}
            </MenuItem>
            <MenuItem icon={<Trash />} danger onSelect={() => void actions.deleteProject(project)}>
              {t('project.delete')}
            </MenuItem>
          </MenuContent>
        </MenuRoot>
        <Tooltip label={t('project.newPage')}>
          <button type="button" onClick={() => void actions.createPage(project.id)} aria-label={t('project.newPageIn', { name: project.name })} className="grid size-6 place-items-center rounded-[6px] text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-press hover:text-ink focus-visible:opacity-100">
            <Plus className="size-[15px]" />
          </button>
        </Tooltip>
      </div>
      {open && (
        <div className="relative ml-[13px] border-l border-line pl-1.5">
          {project.boards.map((b) => (
            <TreeLink key={b.id} to={`${base}/b/${b.id}`} icon={<SquareKanban />} label={b.name} trailing={b.cardCount ? <span className="font-mono text-[10.5px] text-ink-3">{b.cardCount}</span> : null} />
          ))}
          {roots.map((p) => (
            <PageItem key={p.id} page={p} all={project.pages} projectId={project.id} depth={0} />
          ))}
          {project.boards.length === 0 && roots.length === 0 && <p className="px-2 py-1.5 text-[12px] text-ink-3">{t('project.empty')}</p>}
        </div>
      )}
      <ProjectSettingsDialog project={project} open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}

function TreeLink({ to, icon, label, trailing, onToggle, expanded, hasChildren, extra }: { to: string; icon: ReactNode; label: string; trailing?: ReactNode; onToggle?: () => void; expanded?: boolean; hasChildren?: boolean; extra?: ReactNode }) {
  const { t } = useTranslation('shell')
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'group/tree relative flex h-7.5 items-center gap-2 rounded-[7px] pr-1 pl-1.5 text-[13px] transition-colors [&>svg]:size-[14px] [&>svg]:shrink-0',
          isActive ? 'bg-surface font-medium text-ink shadow-sm [&>svg]:text-accent' : 'text-ink-2 hover:bg-hover hover:text-ink [&>svg]:text-ink-3',
        )
      }
    >
      {hasChildren ? (
        <span
          role="button"
          tabIndex={-1}
          aria-label={expanded ? t('tree.collapse') : t('tree.expand')}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onToggle?.()
          }}
          className="-ml-0.5 grid size-4 shrink-0 place-items-center rounded-[4px] text-ink-4 hover:text-ink"
        >
          <ChevronRight className={cn('size-[11px] transition-transform', expanded && 'rotate-90')} />
        </span>
      ) : null}
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {extra}
      {trailing}
    </NavLink>
  )
}

function PageItem({ page, all, projectId, depth }: { page: PageNodeDTO; all: PageNodeDTO[]; projectId: string; depth: number }) {
  const { t } = useTranslation(['shell', 'common'])
  const { workspaceId } = useWorkspace()
  const actions = useStructureActions(workspaceId)
  const children = all.filter((p) => p.parentId === page.id)
  const [open, toggle] = useExpanded(page.id, false)
  return (
    <div>
      <TreeLink
        to={`/w/${workspaceId}/d/${page.id}`}
        icon={page.icon ? <span className="w-[14px] text-center text-[13px] leading-none">{page.icon}</span> : <FileText />}
        label={page.title || t('common:untitled')}
        hasChildren={children.length > 0}
        expanded={open}
        onToggle={() => toggle()}
        extra={
          <span
            role="button"
            tabIndex={-1}
            aria-label={t('tree.newSubpage')}
            title={t('tree.newSubpage')}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              toggle(true)
              void actions.createPage(projectId, page.id)
            }}
            className="grid size-5 shrink-0 place-items-center rounded-[5px] text-ink-3 opacity-0 group-hover/tree:opacity-100 hover:bg-press hover:text-ink"
          >
            <Plus className="size-[13px]" />
          </span>
        }
      />
      {open && children.length > 0 && depth < 12 && (
        <div className="ml-[11px] border-l border-line pl-1.5">
          {children.map((c) => (
            <PageItem key={c.id} page={c} all={all} projectId={projectId} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

function UserMenu() {
  const { t } = useTranslation(['shell', 'common'])
  const { me, workspaceId } = useWorkspace()
  const updateAvailable = useUpdates().data?.updateAvailable ?? false
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [theme, setTheme] = useState(me.user.theme)

  async function changeTheme(value: string) {
    const next = value as typeof theme
    setTheme(next)
    applyTheme(next)
    try {
      await patch('/account', { theme: next })
      await queryClient.invalidateQueries({ queryKey: keys.me })
    } catch {
      // The local preference already applied; the account sync can be retried later.
    }
  }

  async function logout() {
    await post('/auth/logout').catch(() => {})
    lockVault()
    queryClient.clear()
    navigate('/login', { replace: true })
  }

  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <button type="button" className="flex h-10 items-center gap-2.5 rounded-[10px] px-1.5 text-left transition-colors hover:bg-hover data-[state=open]:bg-hover">
          <span className="relative">
            <Avatar name={me.user.name} size={26} />
            {updateAvailable && <span aria-label={t('user.updateAvailable')} className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-accent ring-2 ring-desk" />}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] leading-tight font-medium">{me.user.name}</span>
        </button>
      </MenuTrigger>
      <MenuContent align="start" side="top" className="w-[240px]">
        <MenuItem icon={<Settings />} onSelect={() => navigate(`/w/${workspaceId}/settings`)}>
          <span className="flex items-center justify-between gap-2">
            {t('user.settings')}
            {updateAvailable && <span className="rounded-full bg-accent-soft px-1.5 py-px text-[11px] font-medium text-accent">{t('user.newVersion')}</span>}
          </span>
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>{t('user.appearance')}</MenuLabel>
        <MenuRadioGroup value={theme} onValueChange={changeTheme}>
          <MenuRadioItem value="system" icon={<Monitor />}>
            {t('user.theme.system')}
          </MenuRadioItem>
          <MenuRadioItem value="light" icon={<Sun />}>
            {t('user.theme.light')}
          </MenuRadioItem>
          <MenuRadioItem value="dark" icon={<Moon />}>
            {t('user.theme.dark')}
          </MenuRadioItem>
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem icon={<LogOut />} onSelect={logout}>
          {t('user.signOut')}
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  )
}
