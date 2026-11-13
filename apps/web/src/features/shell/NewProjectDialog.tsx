import type { BoardRefDTO, PaletteColor, ProjectDTO } from '@orqevio/shared'
import { DEFAULT_COLUMNS } from '@orqevio/shared'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ColorPicker } from '../../components/ColorPicker'
import { Button } from '../../components/ui/Button'
import { Checkbox } from '../../components/ui/Checkbox'
import { Dialog } from '../../components/ui/Dialog'
import { Field } from '../../components/ui/Field'
import { currentLocale } from '../../i18n'
import { errorMessage, post } from '../../lib/api'
import { formatList } from '../../lib/format'
import { keys, queryClient } from '../../lib/queries'
import { useWorkspace } from './workspace'

export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation(['shell', 'common'])
  const { workspaceId } = useWorkspace()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [color, setColor] = useState<PaletteColor>('cobalt')
  const [withBoard, setWithBoard] = useState(true)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      const project = await post<ProjectDTO>(`/workspaces/${workspaceId}/projects`, { name: name.trim(), color })
      let target = `/w/${workspaceId}/p/${project.id}`
      if (withBoard) {
        const board = await post<BoardRefDTO>(`/projects/${project.id}/boards`, { name: t('newProject.boardName') })
        target = `/w/${workspaceId}/b/${board.id}`
      }
      await queryClient.invalidateQueries({ queryKey: keys.overview(workspaceId) })
      onOpenChange(false)
      setName('')
      navigate(target)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('newProject.title')} description={t('newProject.description')}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Field label={t('newProject.name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('newProject.namePlaceholder')} maxLength={80} autoFocus />
        <div className="flex flex-col gap-2">
          <span className="text-[12.5px] font-medium text-ink-2">{t('newProject.color')}</span>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-[12px] border border-line bg-surface p-3">
          <Checkbox checked={withBoard} onChange={setWithBoard} label={t('newProject.withBoard')} className="mt-0.5" />
          <span>
            <span className="block text-[13.5px] font-medium">{t('newProject.startWithBoard')}</span>
            <span className="block text-[12.5px] text-ink-3">
              {t('newProject.boardHint', { columns: formatList(DEFAULT_COLUMNS[currentLocale()].map((text) => t('common:quoted', { text }))) })}
            </span>
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
            {t('newProject.create')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
