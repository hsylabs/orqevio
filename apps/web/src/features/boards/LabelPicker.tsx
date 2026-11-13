import type { BoardDTO, LabelDTO, PaletteColor } from '@orqevio/shared'
import { Check, Pencil, Plus, Trash } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ColorPicker } from '../../components/ColorPicker'
import { Button } from '../../components/ui/Button'
import { Popover } from '../../components/ui/Popover'
import { del, errorMessage, patch, post } from '../../lib/api'
import { cn } from '../../lib/cn'
import { keys, queryClient } from '../../lib/queries'

export function LabelPicker({ board, selected, onChange, trigger }: { board: BoardDTO; selected: string[]; onChange: (ids: string[]) => void; trigger: ReactNode }) {
  const { t } = useTranslation(['boards', 'common'])
  const [editing, setEditing] = useState<LabelDTO | 'new' | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState<PaletteColor>('cobalt')

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.board(board.id) })

  function startEdit(label: LabelDTO | 'new') {
    setEditing(label)
    setName(label === 'new' ? '' : label.name)
    setColor(label === 'new' ? 'cobalt' : label.color)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    try {
      if (editing === 'new') {
        const label = await post<LabelDTO>(`/boards/${board.id}/labels`, { name: name.trim(), color })
        onChange([...selected, label.id])
      } else if (editing) {
        await patch(`/labels/${editing.id}`, { name: name.trim(), color })
      }
      await refresh()
      setEditing(null)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function remove(label: LabelDTO) {
    try {
      await del(`/labels/${label.id}`)
      onChange(selected.filter((id) => id !== label.id))
      await refresh()
      setEditing(null)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <Popover trigger={trigger} className="w-[280px]" onOpenChange={(o) => !o && setEditing(null)}>
      {editing ? (
        <form onSubmit={save} className="flex flex-col gap-3 p-1">
          <p className="text-[12.5px] font-semibold">{editing === 'new' ? t('labels.newTitle') : t('labels.editTitle')}</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('labels.namePlaceholder')} aria-label={t('labels.nameLabel')} maxLength={40} className="field h-8.5" autoFocus />
          <ColorPicker value={color} onChange={setColor} />
          <div className="flex items-center justify-between">
            {editing !== 'new' ? (
              <Button size="sm" variant="ghost" icon={<Trash />} onClick={() => void remove(editing)} className="text-danger">
                {t('actions.delete')}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                {t('actions.back')}
              </Button>
              <Button size="sm" variant="primary" type="submit">
                {t('common:actions.save')}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <div className="flex flex-col">
          <p className="px-2 pt-1 pb-2 text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase">{t('labels.title')}</p>
          {board.labels.length === 0 && <p className="px-2 pb-2 text-[12.5px] text-ink-3">{t('labels.empty')}</p>}
          {board.labels.map((l) => {
            const on = selected.includes(l.id)
            return (
              <div key={l.id} className="group flex items-center gap-1 rounded-[8px] hover:bg-hover">
                <button
                  type="button"
                  onClick={() => onChange(on ? selected.filter((id) => id !== l.id) : [...selected, l.id])}
                  aria-pressed={on}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5"
                >
                  <span className={cn('grid size-4 shrink-0 place-items-center rounded-[5px] border', on ? 'border-accent bg-accent' : 'border-line-strong')}>
                    {on && <Check className="size-3 text-accent-ink" strokeWidth={3} />}
                  </span>
                  <span className={cn('label-chip', `c-${l.color}`)}>
                    <span className="truncate">{l.name || t('labels.unnamed')}</span>
                  </span>
                </button>
                <button type="button" onClick={() => startEdit(l)} aria-label={l.name ? t('labels.editNamed', { name: l.name }) : t('labels.editUnnamed')} className="mr-1 grid size-6 place-items-center rounded-[6px] text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-press hover:text-ink focus-visible:opacity-100">
                  <Pencil className="size-3.5" />
                </button>
              </div>
            )
          })}
          <button type="button" onClick={() => startEdit('new')} className="mt-1 flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-[13px] text-ink-2 hover:bg-hover hover:text-ink">
            <Plus className="size-4" />
            {t('labels.create')}
          </button>
        </div>
      )}
    </Popover>
  )
}
