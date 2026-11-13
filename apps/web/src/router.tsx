import { Navigate, createBrowserRouter, useParams } from 'react-router'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import type { CardDetailDTO, PageDTO } from '@orqevio/shared'
import { get } from './lib/api'
import { localPref } from './lib/theme'
import { useMe } from './lib/queries'
import { AuthPage } from './features/auth/AuthPage'
import { AppShell } from './features/shell/AppShell'
import { FullScreenLoader, NotFound } from './features/shell/States'

function RootRedirect() {
  const me = useMe()
  if (me.isPending) return <FullScreenLoader />
  if (me.isError || !me.data) return <Navigate to="/login" replace />
  const last = localPref<string | null>('workspace', null)
  const target = me.data.workspaces.find((w) => w.id === last) ?? me.data.workspaces[0]
  return target ? <Navigate to={`/w/${target.id}`} replace /> : <Navigate to="/login" replace />
}

/** Resolves stable reference links (/card/:id, /doc/:id) used inside Markdown. */
function ReferenceRedirect({ type }: { type: 'card' | 'doc' }) {
  const { id } = useParams()
  const navigate = useNavigate()
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        if (type === 'card') {
          const card = await get<CardDetailDTO>(`/cards/${id}`)
          if (!cancelled) navigate(`/w/${card.workspaceId}/b/${card.boardId}?card=${card.id}`, { replace: true })
        } else {
          const page = await get<PageDTO>(`/pages/${id}`)
          if (!cancelled) navigate(`/w/${page.workspaceId}/d/${page.id}`, { replace: true })
        }
      } catch {
        if (!cancelled) navigate('/', { replace: true })
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id, type, navigate])
  return <FullScreenLoader />
}

export const router = createBrowserRouter([
  { path: '/', element: <RootRedirect /> },
  { path: '/login', element: <AuthPage mode="login" /> },
  { path: '/setup', element: <AuthPage mode="setup" /> },
  { path: '/register', element: <Navigate to="/setup" replace /> },
  { path: '/card/:id', element: <ReferenceRedirect type="card" /> },
  { path: '/doc/:id', element: <ReferenceRedirect type="doc" /> },
  // OAuth authorization endpoint: the consent screen for MCP clients such as Claude.
  { path: '/oauth/authorize', lazy: async () => ({ Component: (await import('./features/oauth/ConsentPage')).ConsentPage }), hydrateFallbackElement: <FullScreenLoader /> },
  {
    path: '/w/:wid',
    element: <AppShell />,
    hydrateFallbackElement: <FullScreenLoader />,
    children: [
      // Route-level code splitting keeps the editor, the vault crypto and the board out of the first load.
      { index: true, lazy: async () => ({ Component: (await import('./features/home/HomePage')).HomePage }) },
      { path: 'p/:projectId', lazy: async () => ({ Component: (await import('./features/projects/ProjectPage')).ProjectPage }) },
      { path: 'b/:boardId', lazy: async () => ({ Component: (await import('./features/boards/BoardPage')).BoardPage }) },
      { path: 'd/:pageId', lazy: async () => ({ Component: (await import('./features/docs/DocPage')).DocPage }) },
      { path: 'vault', lazy: async () => ({ Component: (await import('./features/vault/VaultPage')).VaultPage }) },
      { path: 'agents', lazy: async () => ({ Component: (await import('./features/agents/AgentsPage')).AgentsPage }) },
      { path: 'settings', lazy: async () => ({ Component: (await import('./features/settings/SettingsPage')).SettingsPage }) },
      { path: '*', element: <NotFound /> },
    ],
  },
  { path: '*', element: <NotFound standalone /> },
])
