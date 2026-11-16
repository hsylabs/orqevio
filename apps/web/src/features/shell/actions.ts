import type { BoardRefDTO, PageNodeDTO, TrashedDTO } from '@orqevio/shared'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useConfirm } from '../../components/ui/confirm'
import { usePrompt } from '../../components/ui/prompt'
import { del, errorMessage, post } from '../../lib/api'
import { keys, queryClient } from '../../lib/queries'
import { toastTrashed, trashNote } from '../../lib/trash'

/** Shared creation/deletion flows used by the sidebar, project page and palette. */
export function useStructureActions(workspaceId: string) {
  const { t } = useTranslation(['shell', 'common'])
  const navigate = useNavigate()
  const prompt = usePrompt()
  const confirm = useConfirm()
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.overview(workspaceId) })

  return {
    async createBoard(projectId: string) {
      const name = await prompt({ title: t('actions.newBoard.title'), label: t('actions.newBoard.label'), placeholder: t('actions.newBoard.placeholder'), confirmLabel: t('actions.newBoard.confirm'), maxLength: 80 })
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
        title: t('actions.deleteBoard.title', { name: board.name }),
        description: `${t('actions.deleteBoard.body')} ${trashNote()}`,
        confirmLabel: t('actions.deleteBoard.confirm'),
        danger: true,
      })
      if (!ok) return false
      const trashed = await del<TrashedDTO>(`/boards/${board.id}`)
      await refresh()
      toastTrashed(t('actions.deleteBoard.done'), trashed)
      return true
    },
    async deletePage(page: { id: string; title: string }) {
      const ok = await confirm({
        title: t('actions.deletePage.title', { name: page.title || t('common:untitled') }),
        description: `${t('actions.deletePage.body')} ${trashNote()}`,
        confirmLabel: t('actions.deletePage.confirm'),
        danger: true,
      })
      if (!ok) return false
      const trashed = await del<TrashedDTO>(`/pages/${page.id}`)
      await refresh()
      toastTrashed(t('actions.deletePage.done'), trashed)
      return true
    },
    async deleteProject(project: { id: string; name: string }) {
      const ok = await confirm({
        title: t('actions.deleteProject.title', { name: project.name }),
        description: `${t('actions.deleteProject.body')} ${trashNote()}`,
        confirmLabel: t('actions.deleteProject.confirm'),
        danger: true,
      })
      if (!ok) return false
      const trashed = await del<TrashedDTO>(`/projects/${project.id}`)
      await refresh()
      navigate(`/w/${workspaceId}`)
      toastTrashed(t('actions.deleteProject.done'), trashed)
      return true
    },
  }
}
