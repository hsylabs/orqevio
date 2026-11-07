import type { CardDetailDTO, ChecklistDTO } from '@orqevio/shared'
import { Ellipsis, ListChecks, Plus, Trash, X } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { Checkbox } from '../../components/ui/Checkbox'
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from '../../components/ui/Menu'
import { del, errorMessage, patch, post } from '../../lib/api'
import { keys, queryClient } from '../../lib/queries'

export function Checklists({ card }: { card: CardDetailDTO }) {
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.card(card.id) }),
      queryClient.invalidateQueries({ queryKey: keys.board(card.boardId) }),
    ])

  /** Optimistically patches one item inside the cached card detail. */
  const patchItemLocally = (itemId: string, fn: (i: ChecklistDTO['items'][number]) => ChecklistDTO['items'][number] | null) =>
    queryClient.setQueryData<CardDetailDTO>(keys.card(card.id), (prev) =>
      prev
        ? {
            ...prev,
            checklists: prev.checklists.map((cl) => ({
              ...cl,
              items: cl.items.flatMap((i) => {
                if (i.id !== itemId) return [i]
                const next = fn(i)
                return next ? [next] : []
              }),
            })),
          }
        : prev,
    )

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      await refresh()
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {card.checklists.map((cl) => {
        const done = cl.items.filter((i) => i.done).length
        const pct = cl.items.length ? Math.round((done / cl.items.length) * 100) : 0
        return (
          <section key={cl.id} aria-label={cl.title}>
            <div className="flex items-center gap-2">
              <ListChecks className="size-4 text-ink-3" />
              <EditableText
                value={cl.title}
                onSave={(title) => run(() => patch(`/checklists/${cl.id}`, { title }))}
                className="text-[13.5px] font-semibold"
                label="Título de la checklist"
              />
              <span className="ml-auto font-mono text-[11px] text-ink-3 tabular">
                {done}/{cl.items.length}
              </span>
              <MenuRoot>
                <MenuTrigger asChild>
                  <button type="button" aria-label="Acciones de la checklist" className="grid size-6 place-items-center rounded-[6px] text-ink-3 hover:bg-hover hover:text-ink">
                    <Ellipsis className="size-4" />
                  </button>
                </MenuTrigger>
                <MenuContent>
                  <MenuItem icon={<Trash />} danger onSelect={() => void run(() => del(`/checklists/${cl.id}`))}>
                    Eliminar checklist
                  </MenuItem>
                </MenuContent>
              </MenuRoot>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progreso">
              <div className="h-full rounded-full transition-[width] duration-500 ease-[var(--ease-out-quint)]" style={{ width: `${pct}%`, background: pct === 100 ? 'var(--ok)' : 'var(--accent)' }} />
            </div>
            <ul className="mt-2 flex flex-col">
              {cl.items.map((item) => (
                <li key={item.id} className="group flex items-start gap-2.5 rounded-[8px] px-1 py-1 hover:bg-hover">
                  <Checkbox
                    checked={item.done}
                    label={item.text}
                    className="mt-0.5"
                    onChange={(checked) => {
                      patchItemLocally(item.id, (i) => ({ ...i, done: checked }))
                      void run(() => patch(`/checklist-items/${item.id}`, { done: checked }))
                    }}
                  />
                  <EditableText
                    value={item.text}
                    onSave={(text) => run(() => patch(`/checklist-items/${item.id}`, { text }))}
                    className={item.done ? 'text-[13.5px] text-ink-3 line-through decoration-ink-4' : 'text-[13.5px]'}
                    label="Elemento"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      patchItemLocally(item.id, () => null)
                      void run(() => del(`/checklist-items/${item.id}`))
                    }}
                    aria-label={`Eliminar «${item.text}»`}
                    className="ml-auto grid size-6 shrink-0 place-items-center rounded-[6px] text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-press hover:text-ink focus-visible:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <AddItem onAdd={(text) => run(() => post(`/checklists/${cl.id}/items`, { text }))} />
          </section>
        )
      })}
    </div>
  )
}

function AddItem({ onAdd }: { onAdd: (text: string) => Promise<void> }) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    const value = text.trim()
    if (!value) return
    setText('')
    await onAdd(value)
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-1 flex items-center gap-2 rounded-[8px] px-1 py-1 text-[13px] text-ink-3 hover:text-ink">
        <Plus className="size-4" />
        Añadir elemento
      </button>
    )
  }
  return (
    <form onSubmit={submit} className="mt-1 flex items-center gap-2 pl-1">
      <span className="size-[18px] shrink-0 rounded-[6px] border-[1.5px] border-dashed border-line-strong" />
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => !text.trim() && setOpen(false)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        placeholder="Nuevo elemento y Enter"
        aria-label="Nuevo elemento"
        maxLength={500}
        className="h-8 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-ink-3"
      />
    </form>
  )
}

export function EditableText({ value, onSave, className, label }: { value: string; onSave: (v: string) => Promise<unknown>; className?: string; label: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const commit = () => {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== value) void onSave(next)
    else setDraft(value)
  }
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setDraft(value)
            setEditing(false)
          }
        }}
        aria-label={label}
        className={`min-w-0 flex-1 rounded-[6px] bg-surface px-1 outline-none ring-1 ring-accent ${className ?? ''}`}
      />
    )
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value)
        setEditing(true)
      }}
      className={`min-w-0 flex-1 cursor-text text-left [overflow-wrap:anywhere] ${className ?? ''}`}
    >
      {value}
    </button>
  )
}
