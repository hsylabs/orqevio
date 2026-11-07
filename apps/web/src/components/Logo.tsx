import { cn } from '../lib/cn'

/**
 * The Orqevio mark: an open orbit with a signal dot. The dot turns
 * ultramarine and pulses while an AI agent is working in the workspace.
 */
export function LogoMark({ size = 28, live = false, className }: { size?: number; live?: boolean; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={cn('shrink-0', className)} aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--ink)" />
      <path d="M22.4 9.6A9 9 0 1 0 25 16" fill="none" stroke="var(--sheet)" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="23.6" cy="8.4" r="2.6" fill={live ? 'var(--agent)' : 'var(--accent)'} style={{ transition: 'fill 0.4s' }}>
        {live && <animate attributeName="r" values="2.6;3.3;2.6" dur="1.4s" repeatCount="indefinite" />}
      </circle>
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={cn('font-display text-[19px] font-semibold tracking-[-0.02em]', className)}>Orqevio</span>
}
