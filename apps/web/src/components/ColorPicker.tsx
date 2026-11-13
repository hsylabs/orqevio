import { PALETTE, type PaletteColor } from '@orqevio/shared'
import { t } from 'i18next'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../lib/cn'

export const colorName = (color: PaletteColor) => t(`colors.${color}`)

export function ColorPicker({ value, onChange, label }: { value: PaletteColor; onChange: (c: PaletteColor) => void; label?: string }) {
  const { t } = useTranslation()
  return (
    <div role="radiogroup" aria-label={label ?? t('color')} className="flex flex-wrap gap-1.5">
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={t(`colors.${c}`)}
          title={t(`colors.${c}`)}
          onClick={() => onChange(c)}
          className={cn(
            `c-${c}`,
            'grid size-7 place-items-center rounded-full transition-transform duration-150 hover:scale-110',
            value === c && 'ring-2 ring-[var(--c)] ring-offset-2 ring-offset-sheet',
          )}
          style={{ background: 'var(--c)' }}
        >
          {value === c && <Check className="size-3.5 text-white" strokeWidth={3} />}
        </button>
      ))}
    </div>
  )
}
