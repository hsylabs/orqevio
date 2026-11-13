import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Avatar } from '../../components/ui/Avatar'
import { ApiError } from '../../lib/api'
import { eventSentence } from '../../lib/activity'
import { cn } from '../../lib/cn'
import { useMe, useOverview } from '../../lib/queries'
import { setAgentToast, useRealtime } from '../../lib/realtime'
import { applyTheme, localPref, setLocalPref, storedTheme } from '../../lib/theme'
import { CommandPalette } from './CommandPalette'
import { NewProjectDialog } from './NewProjectDialog'
import { Sidebar } from './Sidebar'
import { FullScreenLoader, NotFound } from './States'
import { WorkspaceContext } from './workspace'

const isDesktop = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches

export function AppShell() {
  const { t } = useTranslation()
  const { wid } = useParams()
  const me = useMe()
  const overview = useOverview(wid)
  const location = useLocation()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(() => (isDesktop() ? localPref('sidebar', true) : false))
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)

  useRealtime(wid, me.data?.user.id)

  useEffect(() => {
    if (wid) setLocalPref('workspace', wid)
  }, [wid])

  // The account preference wins over the local cache once known.
  useEffect(() => {
    const theme = me.data?.user.theme
    if (theme && theme !== storedTheme()) applyTheme(theme)
  }, [me.data?.user.theme])

  // Close the drawer after navigating on small screens.
  useEffect(() => {
    if (!isDesktop()) setSidebarOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape' && !isDesktop()) {
        setSidebarOpen(false)
      }
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      } else if (mod && e.key === '\\') {
        e.preventDefault()
        setSidebarOpen((o) => {
          if (isDesktop()) setLocalPref('sidebar', !o)
          return !o
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    setAgentToast((event) => {
      toast(eventSentence(event), {
        id: `agent-${event.actor.id}`,
        icon: <Avatar name={event.actor.name} kind="agent" size={22} />,
        duration: 3500,
        action:
          event.cardId && event.action !== 'card.archived'
            ? { label: t('actions.view'), onClick: () => navigate(`/card/${event.cardId}`) }
            : event.pageId
              ? { label: t('actions.view'), onClick: () => navigate(`/w/${wid}/d/${event.pageId}`) }
              : undefined,
      })
    })
    return () => setAgentToast(null)
  }, [navigate, wid, t])

  const value = useMemo(
    () =>
      me.data && wid
        ? {
            workspaceId: wid,
            me: me.data,
            overview: overview.data,
            sidebarOpen,
            toggleSidebar: () =>
              setSidebarOpen((o) => {
                if (isDesktop()) setLocalPref('sidebar', !o)
                return !o
              }),
            openPalette: () => setPaletteOpen(true),
            openNewProject: () => setNewProjectOpen(true),
          }
        : null,
    [me.data, wid, overview.data, sidebarOpen],
  )

  if (me.isPending) return <FullScreenLoader />
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
    }
    return <FullScreenLoader />
  }
  if (!value) return <FullScreenLoader />
  if (!me.data.workspaces.some((w) => w.id === wid)) return <NotFound standalone />

  return (
    <WorkspaceContext.Provider value={value}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-[8px] focus:bg-ink focus:px-3 focus:py-2 focus:text-sheet">
        {t('skipToContent')}
      </a>
      <div className="flex h-dvh overflow-hidden bg-desk">
        {/* Mobile overlay */}
        <div
          aria-hidden="true"
          onClick={() => setSidebarOpen(false)}
          className={cn(
            'fixed inset-0 z-30 bg-[rgb(20_18_14/0.3)] transition-opacity duration-300 min-[900px]:hidden',
            sidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        />
        <div
          className={cn(
            'z-40 shrink-0 transition-[width,transform] duration-300 ease-[var(--ease-out-quint)]',
            'max-[899px]:fixed max-[899px]:inset-y-0 max-[899px]:left-0 max-[899px]:w-[272px] max-[899px]:bg-desk max-[899px]:shadow-lg',
            sidebarOpen ? 'max-[899px]:translate-x-0 min-[900px]:w-[260px]' : 'max-[899px]:-translate-x-full min-[900px]:w-0',
          )}
        >
          <div className={cn('h-full w-[260px] max-[899px]:w-[272px]', !sidebarOpen && 'min-[900px]:invisible')}>
            <Sidebar />
          </div>
        </div>
        <main
          id="main"
          className={cn('sheet relative my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[16px] max-[899px]:m-0 max-[899px]:rounded-none', !sidebarOpen && 'min-[900px]:ml-2')}
        >
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} />
    </WorkspaceContext.Provider>
  )
}
