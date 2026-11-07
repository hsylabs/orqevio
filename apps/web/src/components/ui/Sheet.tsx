import { Dialog as D } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

/** Right-hand drawer built on the accessible Radix dialog. */
export function Sheet({ open, onOpenChange, title, children, width = 'max-w-[640px]', label }: { open: boolean; onOpenChange: (open: boolean) => void; title: ReactNode; children: ReactNode; width?: string; label?: string }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-[rgb(20_18_14/0.18)] data-[state=open]:animate-[overlay-in_0.2s_ease-out]" />
        <D.Content
          aria-label={label}
          className={cn(
            'fixed top-2 right-2 bottom-2 z-50 flex w-[calc(100vw-16px)] flex-col overflow-hidden rounded-[18px] border border-line bg-sheet shadow-lg outline-none data-[state=open]:animate-[sheet-in_0.32s_var(--ease-out-quint)]',
            width,
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <D.Title className="sr-only">{title}</D.Title>
          <D.Description className="sr-only">Detalle</D.Description>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

export const SheetClose = D.Close
