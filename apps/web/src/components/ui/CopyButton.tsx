import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { cn } from '../../lib/cn'

export async function copyText(value: string, opts: { clearAfterMs?: number; message?: string } = {}) {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    toast.error('No se ha podido copiar al portapapeles')
    return false
  }
  if (opts.clearAfterMs) {
    setTimeout(() => {
      navigator.clipboard.writeText('').catch(() => {})
    }, opts.clearAfterMs)
  }
  if (opts.message) toast.success(opts.message)
  return true
}

export function CopyButton({ value, label = 'Copiar', className, clearAfterMs, message }: { value: string; label?: string; className?: string; clearAfterMs?: number; message?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={async (e) => {
        e.stopPropagation()
        if (await copyText(value, { clearAfterMs, message })) {
          setDone(true)
          setTimeout(() => setDone(false), 1400)
        }
      }}
      className={cn('grid size-7 shrink-0 place-items-center rounded-[8px] text-ink-3 transition-colors hover:bg-hover hover:text-ink', className)}
    >
      <span className="relative size-[15px]">
        <Copy className={cn('absolute inset-0 size-[15px] transition-all duration-200', done ? 'scale-50 opacity-0' : 'scale-100 opacity-100')} />
        <Check className={cn('absolute inset-0 size-[15px] text-ok transition-all duration-200', done ? 'scale-100 opacity-100' : 'scale-50 opacity-0')} />
      </span>
    </button>
  )
}
