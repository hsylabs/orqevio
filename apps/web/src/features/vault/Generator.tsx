import { Copy, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { copyText } from '../../components/ui/CopyButton'
import { cn } from '../../lib/cn'
import { localPref, setLocalPref } from '../../lib/theme'
import { DEFAULT_GENERATOR, type GeneratorOptions, entropyBits, generatePassword, strengthLabel } from './generator'

export function PasswordText({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn('font-mono break-all', className)}>
      {[...value].map((ch, i) => (
        <span key={i} className={/[0-9]/.test(ch) ? 'text-agent' : /[^a-zA-Z0-9]/.test(ch) ? 'text-accent-text' : undefined}>
          {ch}
        </span>
      ))}
    </span>
  )
}

export function Generator({ onUse }: { onUse?: (password: string) => void }) {
  const { t } = useTranslation(['vault', 'common'])
  const [opts, setOpts] = useState<GeneratorOptions>(() => ({ ...DEFAULT_GENERATOR, ...localPref<Partial<GeneratorOptions>>('generator', {}) }))
  const [value, setValue] = useState(() => generatePassword(opts))
  const regenerate = useCallback((o: GeneratorOptions) => setValue(generatePassword(o)), [])

  useEffect(() => {
    setLocalPref('generator', opts)
    regenerate(opts)
  }, [opts, regenerate])

  const bits = entropyBits(opts)
  const strength = strengthLabel(bits)
  const toggle = (key: 'lower' | 'upper' | 'digits' | 'symbols' | 'avoidAmbiguous') => {
    const next = { ...opts, [key]: !opts[key] }
    if (!next.lower && !next.upper && !next.digits && !next.symbols) return
    setOpts(next)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative rounded-[12px] border border-line bg-sunken px-4 py-4 pr-20">
        <PasswordText value={value} className="text-[17px] leading-relaxed" />
        <div className="absolute top-2 right-2 flex gap-0.5">
          <button type="button" onClick={() => regenerate(opts)} aria-label={t('generator.regenerate')} title={t('generator.regenerate')} className="grid size-8 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink">
            <RefreshCw className="size-4" />
          </button>
          <button type="button" onClick={() => void copyText(value, { clearAfterMs: 30_000, message: t('generator.copied') })} aria-label={t('common:actions.copy')} title={t('common:actions.copy')} className="grid size-8 place-items-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink">
            <Copy className="size-4" />
          </button>
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
          <span className={cn('font-medium', strength.tone === 'danger' ? 'text-danger' : strength.tone === 'warn' ? 'text-warn' : 'text-ok')}>{strength.label}</span>
          <span className="font-mono text-ink-3">{t('generator.entropy', { bits })}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.min(100, (bits / 128) * 100)}%`, background: strength.tone === 'danger' ? 'var(--danger)' : strength.tone === 'warn' ? 'var(--warn)' : 'var(--ok)' }} />
        </div>
      </div>

      <label className="flex flex-col gap-2">
        <span className="flex justify-between text-[12.5px] font-medium text-ink-2">
          {t('generator.length')} <span className="font-mono text-ink">{opts.length}</span>
        </span>
        <input type="range" min={8} max={64} value={opts.length} onChange={(e) => setOpts({ ...opts, length: Number(e.target.value) })} className="w-full accent-[var(--accent)]" aria-label={t('generator.length')} />
      </label>

      <div className="grid grid-cols-2 gap-1.5">
        {(
          [
            ['upper', 'A–Z'],
            ['lower', 'a–z'],
            ['digits', '0–9'],
            ['symbols', '!#$%'],
          ] as const
        ).map(([key, sample]) => (
          <button
            key={key}
            type="button"
            role="switch"
            aria-checked={opts[key]}
            onClick={() => toggle(key)}
            className={cn('flex items-center justify-between rounded-[10px] border px-3 py-2 text-left text-[13px] transition-colors', opts[key] ? 'border-ink/20 bg-surface text-ink shadow-sm' : 'border-line text-ink-3')}
          >
            {t(`generator.sets.${key}`)}
            <span className="font-mono text-[11.5px] text-ink-3">{sample}</span>
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-[13px] text-ink-2">
        <input type="checkbox" checked={opts.avoidAmbiguous} onChange={() => toggle('avoidAmbiguous')} className="size-4 accent-[var(--accent)]" />
        {t('generator.avoidAmbiguous')}
      </label>
      {onUse && (
        <Button variant="primary" onClick={() => onUse(value)}>
          {t('generator.use')}
        </Button>
      )}
    </div>
  )
}
