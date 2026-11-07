import { Bot } from 'lucide-react'
import { cn } from '../../lib/cn'
import { initials } from '../../lib/format'

export function Avatar({ name, kind = 'user', size = 24, className }: { name: string; kind?: 'user' | 'agent'; size?: number; className?: string }) {
  return (
    <span
      title={name}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full font-semibold select-none',
        kind === 'agent' ? 'bg-agent-soft text-agent ring-1 ring-agent/30' : 'bg-ink text-sheet',
        className,
      )}
    >
      {kind === 'agent' ? <Bot style={{ width: size * 0.58, height: size * 0.58 }} strokeWidth={2} /> : initials(name)}
    </span>
  )
}
