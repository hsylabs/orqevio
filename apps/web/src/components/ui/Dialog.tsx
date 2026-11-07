import { Dialog as D } from 'radix-ui'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: string
  hideClose?: boolean
}

export function Dialog({ open, onOpenChange, title, description, children, footer, width = 'max-w-[460px]', hideClose }: DialogProps) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-[rgb(20_18_14/0.32)] backdrop-blur-[2px] data-[state=open]:animate-[overlay-in_0.2s_ease-out]" />
        <D.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[min(88dvh,760px)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[18px] border border-line bg-sheet shadow-lg outline-none data-[state=open]:animate-[dialog-in_0.26s_var(--ease-out-quint)]',
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-1">
            <div className="min-w-0">
              <D.Title className="font-display text-[21px] leading-tight font-medium">{title}</D.Title>
              {description ? (
                <D.Description className="mt-1.5 text-[13.5px] text-ink-2">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{typeof title === 'string' ? title : 'Diálogo'}</D.Description>
              )}
            </div>
            {!hideClose && (
              <D.Close className="-mr-2 grid size-8 shrink-0 place-items-center rounded-[9px] text-ink-3 hover:bg-hover hover:text-ink" aria-label="Cerrar">
                <X className="size-4" />
              </D.Close>
            )}
          </div>
          <div className="min-h-0 overflow-y-auto px-6 pt-3 pb-5">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-3.5">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
