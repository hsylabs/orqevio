import { cn } from '../../lib/cn'

/** Round, animated checkbox used for checklist items. */
export function Checkbox({ checked, onChange, label, className, size = 18 }: { checked: boolean; onChange: (checked: boolean) => void; label: string; className?: string; size?: number }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      style={{ width: size, height: size }}
      className={cn(
        'group relative grid shrink-0 place-items-center rounded-[6px] border-[1.5px] transition-[background-color,border-color,transform] duration-200 active:scale-90',
        checked ? 'border-accent bg-accent' : 'border-line-strong bg-surface hover:border-ink-3',
        className,
      )}
    >
      <svg viewBox="0 0 16 16" className="size-[72%]" aria-hidden="true">
        <path
          d="M3.5 8.5 6.5 11.5 12.5 4.5"
          fill="none"
          stroke="var(--accent-ink)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ strokeDasharray: 16, strokeDashoffset: checked ? 0 : 16, transition: 'stroke-dashoffset 0.28s var(--ease-out-quint)' }}
        />
      </svg>
    </button>
  )
}
