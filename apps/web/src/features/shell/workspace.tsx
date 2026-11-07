import type { MeDTO, OverviewDTO } from '@orqevio/shared'
import { createContext, useContext } from 'react'

export interface WorkspaceContextValue {
  workspaceId: string
  me: MeDTO
  overview: OverviewDTO | undefined
  sidebarOpen: boolean
  toggleSidebar: () => void
  openPalette: () => void
  openNewProject: () => void
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function useWorkspace() {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('useWorkspace must be used inside AppShell')
  return value
}
