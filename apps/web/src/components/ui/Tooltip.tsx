import { Tooltip as T } from 'radix-ui'
import type { ReactNode } from 'react'
import { Kbd } from './Kbd'

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <T.Provider delayDuration={350} skipDelayDuration={150}>
      {children}
    </T.Provider>
  )
}

export function Tooltip({ label, keys, side = 'top', children }: { label: ReactNode; keys?: string[]; side?: 'top' | 'bottom' | 'left' | 'right'; children: ReactNode }) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-50 flex items-center gap-2 rounded-[8px] bg-ink px-2 py-1 text-[12px] font-medium text-sheet shadow-md"
        >
          {label}
          {keys && (
            <span className="opacity-70 [&_.kbd]:border-transparent [&_.kbd]:bg-white/15 [&_.kbd]:text-sheet [&_.kbd]:shadow-none">
              <Kbd keys={keys} />
            </span>
          )}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}
