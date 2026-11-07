import type { CardSummaryDTO, LabelDTO } from '@orqevio/shared'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Bot, Calendar, FileText, Paperclip, TextAlignStart } from 'lucide-react'
import { memo } from 'react'
import { cn } from '../../lib/cn'
import { dueLabel, dueState } from '../../lib/format'
import { useAgentHighlight } from '../../lib/realtime'

export function DueChip({ dueAt, className }: { dueAt: string; className?: string }) {
  const state = dueState(dueAt)
  return (
    <span
      className={cn(
        'inline-flex h-[20px] items-center gap-1 rounded-[6px] px-1.5 text-[11.5px] font-medium tabular',
        state === 'overdue' && 'bg-danger-soft text-danger',
        state === 'today' && 'bg-accent-soft text-accent-text',
        state === 'soon' && 'bg-[color-mix(in_oklab,var(--warn)_14%,transparent)] text-warn',
        state === 'later' && 'text-ink-3',
        className,
      )}
      title={new Date(dueAt).toLocaleDateString('es-ES', { dateStyle: 'full', timeZone: 'UTC' })}
    >
      <Calendar className="size-3" />
      {dueLabel(dueAt)}
    </span>
  )
}

export function ProgressRing({ done, total, size = 14 }: { done: number; total: number; size?: number }) {
  const r = (size - 3) / 2
  const c = 2 * Math.PI * r
  const complete = total > 0 && done === total
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-strong)" strokeWidth="2" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={complete ? 'var(--ok)' : 'var(--accent)'}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c - (total ? done / total : 0) * c}
        style={{ transition: 'stroke-dashoffset 0.4s var(--ease-out-quint)' }}
      />
    </svg>
  )
}

interface CardViewProps {
  card: CardSummaryDTO
  labels: Map<string, LabelDTO>
  overlay?: boolean
  ghost?: boolean
}

export const CardView = memo(function CardView({ card, labels, overlay, ghost }: CardViewProps) {
  const agent = useAgentHighlight(card.id)
  const cardLabels = card.labelIds.map((id) => labels.get(id)).filter((l): l is LabelDTO => Boolean(l))
  const hasMeta = card.dueAt || card.checklist.total || card.hasDescription || card.linkedPages || card.attachments || card.createdBy?.kind === 'agent'
  return (
    <div
      className={cn(
        'group/card relative rounded-[11px] border border-line bg-surface px-3 pt-2.5 pb-2.5 text-left shadow-sm transition-[box-shadow,border-color,transform] duration-150',
        !overlay && !ghost && 'hover:border-line-strong hover:shadow-md',
        overlay && 'rotate-[-2deg] scale-[1.03] cursor-grabbing border-line-strong shadow-lg',
        ghost && 'opacity-35 [&>*]:invisible',
        agent && 'agent-glow border-agent/40',
      )}
    >
      {agent && (
        <span className="animate-pop absolute -top-2.5 right-2 inline-flex h-5 items-center gap-1 rounded-full bg-agent px-2 text-[10.5px] font-semibold text-agent-ink shadow-md">
          <Bot className="size-3" />
          {agent}
        </span>
      )}
      {cardLabels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {cardLabels.map((l) =>
            l.name ? (
              <span key={l.id} className={cn('label-chip', `c-${l.color}`)}>
                <span className="truncate">{l.name}</span>
              </span>
            ) : (
              <span key={l.id} className={cn('label-bar', `c-${l.color}`)} />
            ),
          )}
        </div>
      )}
      <p className="text-[13.5px] leading-snug font-[520] text-ink [overflow-wrap:anywhere]">{card.title}</p>
      {hasMeta ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-ink-3">
          {card.dueAt && <DueChip dueAt={card.dueAt} />}
          {card.checklist.total > 0 && (
            <span className={cn('inline-flex items-center gap-1 tabular', card.checklist.done === card.checklist.total && 'text-ok')} title="Checklist">
              <ProgressRing done={card.checklist.done} total={card.checklist.total} />
              {card.checklist.done}/{card.checklist.total}
            </span>
          )}
          {card.hasDescription && <TextAlignStart className="size-3.5" aria-label="Tiene descripción" />}
          {card.linkedPages > 0 && (
            <span className="inline-flex items-center gap-0.5" title="Documentos vinculados">
              <FileText className="size-3.5" />
              {card.linkedPages}
            </span>
          )}
          {card.attachments > 0 && (
            <span className="inline-flex items-center gap-0.5" title="Adjuntos">
              <Paperclip className="size-3.5" />
              {card.attachments}
            </span>
          )}
          {card.createdBy?.kind === 'agent' && (
            <span className="ml-auto inline-flex items-center gap-1 text-agent" title={`Creada por ${card.createdBy.name}`}>
              <Bot className="size-3.5" />
            </span>
          )}
        </div>
      ) : null}
    </div>
  )
})

export function SortableCard({ card, labels, onOpen, disabled }: { card: CardSummaryDTO; labels: Map<string, LabelDTO>; onOpen: (id: string) => void; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card', title: card.title },
    disabled,
  })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-roledescription="tarjeta"
      aria-label={card.title}
      onClick={() => onOpen(card.id)}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e)
        if (e.key === 'Enter' && !e.defaultPrevented) onOpen(card.id)
      }}
      className="list-none rounded-[11px] outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-sunken"
    >
      <CardView card={card} labels={labels} ghost={isDragging} />
    </li>
  )
}
