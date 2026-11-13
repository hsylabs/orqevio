import type { CardSummaryDTO, ColumnDTO, LabelDTO } from '@orqevio/shared'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Ellipsis, Pencil, Plus, Trash } from 'lucide-react'
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from '../../components/ui/Menu'
import { cn } from '../../lib/cn'
import { SortableCard } from './CardItem'

interface ColumnProps {
  column: ColumnDTO
  cards: CardSummaryDTO[]
  labels: Map<string, LabelDTO>
  dragDisabled: boolean
  filtered: boolean
  onOpenCard: (id: string) => void
  onAddCard: (columnId: string, title: string) => Promise<void>
  onRename: (columnId: string, name: string) => Promise<void>
  onDelete: (column: ColumnDTO, count: number) => Promise<void>
}

export function BoardColumn({ column, cards, labels, dragDisabled, filtered, onOpenCard, onAddCard, onRename, onDelete }: ColumnProps) {
  const { t } = useTranslation('boards')
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: column.id,
    data: { type: 'column', title: column.name },
    disabled: dragDisabled,
  })
  const [composing, setComposing] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(column.name)

  useEffect(() => setName(column.name), [column.name])

  async function commitRename() {
    setRenaming(false)
    const next = name.trim()
    if (next && next !== column.name) await onRename(column.id, next)
    else setName(column.name)
  }

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      aria-label={t('column.region', { name: column.name })}
      className={cn('flex max-h-full w-[288px] shrink-0 flex-col rounded-[14px] bg-sunken shadow-[inset_0_0_0_1px_var(--line)]', isDragging && 'opacity-40')}
    >
      <header className="flex h-10 shrink-0 items-center gap-1.5 pt-1 pr-1.5 pl-3">
        {renaming ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitRename()
              if (e.key === 'Escape') {
                setName(column.name)
                setRenaming(false)
              }
            }}
            maxLength={60}
            aria-label={t('column.name')}
            className="h-7 min-w-0 flex-1 rounded-[7px] border border-accent bg-surface px-2 text-[13px] font-semibold outline-none"
          />
        ) : (
          <button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            type="button"
            onDoubleClick={() => setRenaming(true)}
            aria-roledescription={t('column.roleDescription')}
            aria-label={t('column.handle', { name: column.name })}
            className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-[7px] py-1 text-left', !dragDisabled && 'cursor-grab active:cursor-grabbing')}
          >
            <span className="truncate text-[13px] font-semibold text-ink">{column.name}</span>
            <span className="font-mono text-[11px] text-ink-3 tabular">{cards.length}</span>
          </button>
        )}
        <button type="button" onClick={() => setComposing(true)} aria-label={t('column.addCardTo', { name: column.name })} className="grid size-7 place-items-center rounded-[7px] text-ink-3 hover:bg-hover hover:text-ink">
          <Plus className="size-[15px]" />
        </button>
        <MenuRoot>
          <MenuTrigger asChild>
            <button type="button" aria-label={t('column.actions', { name: column.name })} className="grid size-7 place-items-center rounded-[7px] text-ink-3 hover:bg-hover hover:text-ink data-[state=open]:bg-hover">
              <Ellipsis className="size-[15px]" />
            </button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem icon={<Pencil />} onSelect={() => setRenaming(true)}>
              {t('actions.rename')}
            </MenuItem>
            <MenuItem icon={<Plus />} onSelect={() => setComposing(true)}>
              {t('column.addCard')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Trash />} danger onSelect={() => void onDelete(column, cards.length)}>
              {t('column.delete')}
            </MenuItem>
          </MenuContent>
        </MenuRoot>
      </header>

      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ol className="flex min-h-[8px] flex-col gap-2 overflow-y-auto px-2 pt-3 pb-2" aria-label={t('column.cards', { name: column.name })}>
          {cards.map((card) => (
            <SortableCard key={card.id} card={card} labels={labels} onOpen={onOpenCard} disabled={dragDisabled} />
          ))}
          {cards.length === 0 && !composing && (
            <li className="list-none rounded-[10px] border border-dashed border-line-strong/70 px-3 py-5 text-center text-[12px] text-ink-3">
              {filtered ? t('column.noMatches') : t('column.dropHere')}
            </li>
          )}
        </ol>
      </SortableContext>

      <div className="shrink-0 px-2 pb-2">
        {composing ? (
          <Composer
            onSubmit={(title) => onAddCard(column.id, title)}
            onClose={() => setComposing(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="flex h-8 w-full items-center gap-1.5 rounded-[9px] px-2 text-[13px] text-ink-3 transition-colors hover:bg-hover hover:text-ink"
          >
            <Plus className="size-[15px]" />
            {t('column.addCard')}
          </button>
        )}
      </div>
    </section>
  )
}

function Composer({ onSubmit, onClose }: { onSubmit: (title: string) => Promise<void>; onClose: () => void }) {
  const { t } = useTranslation('boards')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    const value = title.trim()
    if (!value || busy) return
    setBusy(true)
    try {
      await onSubmit(value)
      setTitle('')
      ref.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    } else if (e.key === 'Escape') onClose()
  }

  return (
    <form onSubmit={submit} className="animate-pop rounded-[11px] border border-accent bg-surface p-2 shadow-md">
      <textarea
        ref={ref}
        autoFocus
        rows={2}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => !title.trim() && onClose()}
        placeholder={t('composer.placeholder')}
        aria-label={t('card.title')}
        maxLength={300}
        className="block w-full resize-none bg-transparent text-[13.5px] leading-snug outline-none placeholder:text-ink-3"
      />
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[11px] text-ink-3">
          <Trans t={t} i18nKey="composer.hint" components={{ kbd: <kbd className="kbd" /> }} />
        </span>
        <button type="submit" disabled={!title.trim() || busy} className="h-7 rounded-[8px] bg-ink px-2.5 text-[12px] font-medium text-sheet disabled:opacity-40">
          {t('composer.submit')}
        </button>
      </div>
    </form>
  )
}
