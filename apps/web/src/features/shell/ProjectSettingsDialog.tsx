import type { PaletteColor, ProjectTreeDTO } from '@orqevio/shared'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ColorPicker } from '../../components/ColorPicker'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Field } from '../../components/ui/Field'
import { errorMessage, patch } from '../../lib/api'
import { keys, queryClient } from '../../lib/queries'

export function ProjectSettingsDialog({ project, open, onOpenChange }: { project: ProjectTreeDTO; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation(['shell', 'common'])
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? '')
  const [color, setColor] = useState<PaletteColor>(project.color)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName(project.name)
      setDescription(project.description ?? '')
      setColor(project.color)
    }
  }, [open, project])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await patch(`/projects/${project.id}`, { name: name.trim(), color, description: description.trim() })
      await queryClient.invalidateQueries({ queryKey: keys.overview(project.workspaceId) })
      onOpenChange(false)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('projectSettings.title')}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Field label={t('projectSettings.name')} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
        <Field label={t('projectSettings.description')} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder={t('projectSettings.optional')} />
        <div className="flex flex-col gap-2">
          <span className="text-[12.5px] font-medium text-ink-2">{t('projectSettings.color')}</span>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
            {t('common:actions.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
