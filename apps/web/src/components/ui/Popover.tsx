import { Popover as P } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  align = 'start',
  className,
}: {
  trigger: ReactNode
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: 'start' | 'center' | 'end'
  className?: string
}) {
  return (
    <P.Root open={open} onOpenChange={onOpenChange}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className={cn('z-50 rounded-[14px] border border-line bg-surface p-2 shadow-lg outline-none', className)}
        >
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}
