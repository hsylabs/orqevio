import type { BoardRefDTO, PageNodeDTO } from '@orqevio/shared'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useConfirm } from '../../components/ui/confirm'
import { usePrompt } from '../../components/ui/prompt'
import { del, errorMessage, post } from '../../lib/api'
import { keys, queryClient } from '../../lib/queries'

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
        description: t('actions.deleteBoard.body'),
        confirmLabel: t('actions.deleteBoard.confirm'),
        danger: true,
      })
      if (!ok) return false
      await del(`/boards/${board.id}`)
      await refresh()
      toast.success(t('actions.deleteBoard.done'))
      return true
    },
    async deletePage(page: { id: string; title: string }) {
      const ok = await confirm({
        title: t('actions.deletePage.title', { name: page.title || t('common:untitled') }),
        description: t('actions.deletePage.body'),
        confirmLabel: t('actions.deletePage.confirm'),
        danger: true,
      })
      if (!ok) return false
      await del(`/pages/${page.id}`)
      await refresh()
      toast.success(t('actions.deletePage.done'))
      return true
    },
    async deleteProject(project: { id: string; name: string }) {
      const ok = await confirm({
        title: t('actions.deleteProject.title', { name: project.name }),
        description: t('actions.deleteProject.body'),
        confirmLabel: t('actions.deleteProject.confirm'),
        danger: true,
      })
      if (!ok) return false
      await del(`/projects/${project.id}`)
      await refresh()
      navigate(`/w/${workspaceId}`)
      toast.success(t('actions.deleteProject.done'))
      return true
    },
  }
}
