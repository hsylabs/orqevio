import type { BoardRefDTO, PageNodeDTO } from '@orqevio/shared'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useConfirm } from '../../components/ui/confirm'
import { usePrompt } from '../../components/ui/prompt'
import { del, errorMessage, post } from '../../lib/api'
import { keys, queryClient } from '../../lib/queries'

/** Shared creation/deletion flows used by the sidebar, project page and palette. */
export function useStructureActions(workspaceId: string) {
  const navigate = useNavigate()
  const prompt = usePrompt()
  const confirm = useConfirm()
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.overview(workspaceId) })

  return {
    async createBoard(projectId: string) {
      const name = await prompt({ title: 'Nuevo tablero', label: 'Nombre del tablero', placeholder: 'p. ej. Sprint de lanzamiento', confirmLabel: 'Crear tablero', maxLength: 80 })
      if (!name) return
      try {
        const board = await post<BoardRefDTO>(`/projects/${projectId}/boards`, { name })
        await refresh()
        navigate(`/w/${workspaceId}/b/${board.id}`)
      } catch (error) {
        toast.error(errorMessage(error))
      }
    },
    async createPage(projectId: string, parentId: string | null = null) {
      try {
        const page = await post<PageNodeDTO>(`/projects/${projectId}/pages`, { title: '', parentId })
        await refresh()
        navigate(`/w/${workspaceId}/d/${page.id}`, { state: { focusTitle: true } })
      } catch (error) {
        toast.error(errorMessage(error))
      }
    },
    async deleteBoard(board: { id: string; name: string }) {
      const ok = await confirm({
        title: `¿Eliminar «${board.name}»?`,
        description: 'Se eliminarán sus columnas y tarjetas. Esta acción no se puede deshacer.',
        confirmLabel: 'Eliminar tablero',
        danger: true,
      })
      if (!ok) return false
      await del(`/boards/${board.id}`)
      await refresh()
      toast.success('Tablero eliminado')
      return true
    },
    async deletePage(page: { id: string; title: string }) {
      const ok = await confirm({
        title: `¿Eliminar «${page.title || 'Sin título'}»?`,
        description: 'También se eliminarán sus subpáginas y adjuntos. Esta acción no se puede deshacer.',
        confirmLabel: 'Eliminar página',
        danger: true,
      })
      if (!ok) return false
      await del(`/pages/${page.id}`)
      await refresh()
      toast.success('Página eliminada')
      return true
    },
    async deleteProject(project: { id: string; name: string }) {
      const ok = await confirm({
        title: `¿Eliminar el proyecto «${project.name}»?`,
        description: 'Se eliminarán todos sus tableros, tarjetas, páginas y adjuntos. Esta acción no se puede deshacer.',
        confirmLabel: 'Eliminar proyecto',
        danger: true,
      })
      if (!ok) return false
      await del(`/projects/${project.id}`)
      await refresh()
      navigate(`/w/${workspaceId}`)
      toast.success('Proyecto eliminado')
      return true
    },
  }
}
