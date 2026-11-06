import { PALETTE, type PaletteColor } from '@orqevio/shared'
import { Check } from 'lucide-react'
import { cn } from '../lib/cn'

export const COLOR_NAMES: Record<PaletteColor, string> = {
  tomato: 'Caqui',
  amber: 'Ámbar',
  lime: 'Lima',
  jade: 'Jade',
  teal: 'Turquesa',
  cobalt: 'Cobalto',
  iris: 'Iris',
  rose: 'Rosa',
  slate: 'Pizarra',
}

export function ColorPicker({ value, onChange, label = 'Color' }: { value: PaletteColor; onChange: (c: PaletteColor) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={COLOR_NAMES[c]}
          title={COLOR_NAMES[c]}
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
