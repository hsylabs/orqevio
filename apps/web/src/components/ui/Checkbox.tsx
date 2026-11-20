import type React from 'react'
import { cn } from '../../lib/cn'

/** Round, animated checkbox used for checklist items. */
export function Checkbox({
  checked,
  onChange,
  label,
  className,
  size = 18,
  disabled,
  mixed,
}: {
  checked: boolean
  /** With the click, to tell a Shift+click (a range) apart. */
  onChange: (checked: boolean, event: React.MouseEvent) => void
  label: string
  className?: string
  size?: number
  disabled?: boolean
  /** Some of what it stands for is checked, not all: shown as a dash. */
  mixed?: boolean
}) {
  const shown = checked || Boolean(mixed)
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed && !checked ? 'mixed' : checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked, e)
      }}
      style={{ width: size, height: size }}
      className={cn(
        'group relative grid shrink-0 place-items-center rounded-[6px] border-[1.5px] transition-[background-color,border-color,transform] duration-200 active:scale-90 disabled:pointer-events-none disabled:opacity-40',
        shown ? 'border-accent bg-accent' : 'border-line-strong bg-surface hover:border-ink-3',
        className,
      )}
    >
      <svg viewBox="0 0 16 16" className="size-[72%]" aria-hidden="true">
        {mixed && !checked && <path d="M4 8h8" fill="none" stroke="var(--accent-ink)" strokeWidth="2.2" strokeLinecap="round" />}
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
