import { Check, Copy } from 'lucide-react'
import { t } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cancelClipboardClear, clearClipboardLater, clearClipboardNow } from '../../lib/clipboard'
import { cn } from '../../lib/cn'

/** Copies `value`; with `clearAfterMs`, it is a secret, cleared from the clipboard once the time is up. */
export async function copyText(value: string, opts: { clearAfterMs?: number; message?: string } = {}) {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    toast.error(t('copyFailed'))
    return false
  }
  if (opts.clearAfterMs) clearClipboardLater(value, opts.clearAfterMs, remindToClear)
  else cancelClipboardClear()
  if (opts.message) toast.success(opts.message)
  return true
}

/** The browser didn't let the page clear the clipboard by itself: a click on the reminder does. */
function remindToClear() {
  toast(t('clipboard.stillThere'), {
    duration: 60_000,
    action: {
      label: t('clipboard.clear'),
      onClick: async () => {
        if (await clearClipboardNow()) toast.success(t('clipboard.cleared'))
        else toast.error(t('clipboard.clearFailed'))
      },
    },
  })
}

export function CopyButton({ value, label: customLabel, className, clearAfterMs, message }: { value: string; label?: string; className?: string; clearAfterMs?: number; message?: string }) {
  const { t } = useTranslation()
  const label = customLabel ?? t('actions.copy')
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
