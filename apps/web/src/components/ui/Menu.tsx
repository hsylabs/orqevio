import { DropdownMenu as M } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export const MenuRoot = M.Root
export const MenuTrigger = M.Trigger

export function MenuContent({ children, align = 'end', className, side }: { children: ReactNode; align?: 'start' | 'end' | 'center'; className?: string; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        side={side}
        sideOffset={6}
        collisionPadding={12}
        className={cn('z-50 min-w-[200px] rounded-[12px] border border-line bg-surface p-1 shadow-lg outline-none', className)}
      >
        {children}
      </M.Content>
    </M.Portal>
  )
}

export function MenuItem({ icon, children, onSelect, danger, shortcut, disabled }: { icon?: ReactNode; children: ReactNode; onSelect?: (e: Event) => void; danger?: boolean; shortcut?: string; disabled?: boolean }) {
  return (
    <M.Item
      onSelect={onSelect}
      disabled={disabled}
      className={cn(
        'flex h-8 cursor-default items-center gap-2.5 rounded-[8px] px-2 text-[13px] outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-hover [&_svg]:size-[15px] [&_svg]:text-ink-3',
        danger ? 'text-danger data-[highlighted]:bg-danger-soft [&_svg]:text-danger' : 'text-ink',
      )}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <span className="font-mono text-[11px] text-ink-3">{shortcut}</span>}
    </M.Item>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <M.Label className="px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-[0.06em] text-ink-3 uppercase">{children}</M.Label>
}

export function MenuSeparator() {
  return <M.Separator className="my-1 h-px bg-line" />
}

export const MenuRadioGroup = M.RadioGroup

export function MenuRadioItem({ value, children, icon }: { value: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <M.RadioItem
      value={value}
      className="flex h-8 cursor-default items-center gap-2.5 rounded-[8px] px-2 text-[13px] outline-none select-none data-[highlighted]:bg-hover data-[state=checked]:font-medium [&_svg]:size-[15px] [&_svg]:text-ink-3"
    >
      {icon}
      <span className="flex-1">{children}</span>
      <M.ItemIndicator>
        <span className="block size-1.5 rounded-full bg-accent" />
      </M.ItemIndicator>
    </M.RadioItem>
  )
}
