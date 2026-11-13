import { t } from 'i18next'
import { Copy, Download } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { copyText } from '../../components/ui/CopyButton'

function downloadKey(accessKey: string) {
  const text = [
    t('auth:keyFile.title'),
    '',
    t('auth:keyFile.address', { address: window.location.origin }),
    t('auth:keyFile.key', { key: accessKey }),
    '',
    t('auth:keyFile.use'),
    t('auth:keyFile.lost'),
    '',
  ].join('\n')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = t('auth:keyFile.name')
  a.click()
  URL.revokeObjectURL(url)
}

/** Shows a freshly issued access key once, and only lets the user continue after confirming it is saved. */
export function AccessKeyReveal({ accessKey, confirmLabel, onDone, busy }: { accessKey: string; confirmLabel: string; onDone: () => void; busy?: boolean }) {
  const { t } = useTranslation(['auth', 'common'])
  const [saved, setSaved] = useState(false)
  return (
    <div>
      <div className="rounded-[14px] border border-line bg-sunken p-4">
        {/* Wraps only between groups, so no group of four is ever split. */}
        <p aria-label={t('keyReveal.label')} className="text-center font-mono text-[15.5px] leading-relaxed font-medium tracking-[0.06em] text-balance break-words text-ink select-all">
          {accessKey}
        </p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button icon={<Copy />} onClick={() => void copyText(accessKey, { message: t('keyReveal.copied') })}>
          {t('common:actions.copy')}
        </Button>
        <Button icon={<Download />} onClick={() => downloadKey(accessKey)}>
          {t('keyReveal.download')}
        </Button>
      </div>
      <label className="mt-5 flex cursor-pointer items-start gap-3 text-[13px] text-ink-2">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
        {t('keyReveal.saved')}
      </label>
      <Button variant="primary" size="lg" className="mt-5 w-full" disabled={!saved} loading={busy} onClick={onDone}>
        {confirmLabel}
      </Button>
    </div>
  )
}
