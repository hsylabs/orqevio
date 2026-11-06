import { cn } from '../../lib/cn'

/** Animated lock: the shackle lifts when `open` turns true. */
export function VaultLockArt({ open = false, busy = false, className }: { open?: boolean; busy?: boolean; className?: string }) {
  return (
    <div className={cn('relative grid size-[132px] place-items-center', className)} aria-hidden="true">
      <span className={cn('absolute inset-0 rounded-full border border-line-strong', busy && 'animate-[spin_6s_linear_infinite] border-dashed')} />
      <span className="absolute inset-[14px] rounded-full border border-line" />
      <span className="absolute inset-[30px] rounded-full bg-surface shadow-md" />
      <svg viewBox="0 0 48 48" className="relative size-[46px]">
        <path
          d="M15 22v-6a9 9 0 0 1 18 0v6"
          fill="none"
          stroke="var(--ink)"
          strokeWidth="3.4"
          strokeLinecap="round"
          style={{ transform: open ? 'translateY(-5px) rotate(-14deg)' : 'none', transformOrigin: '33px 22px', transition: 'transform 0.5s var(--ease-spring)' }}
        />
        <rect x="10" y="21" width="28" height="21" rx="6" fill="var(--ink)" />
        <circle cx="24" cy="30.5" r="3" fill={open ? 'var(--ok)' : 'var(--accent)'} style={{ transition: 'fill 0.3s' }} />
        <rect x="22.6" y="31" width="2.8" height="5.5" rx="1.4" fill={open ? 'var(--ok)' : 'var(--accent)'} style={{ transition: 'fill 0.3s' }} />
      </svg>
    </div>
  )
}
