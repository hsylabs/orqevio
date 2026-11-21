import { isPaletteColor, PALETTE, type PaletteColor, type ProjectColor } from '@orqevio/shared'
import { t } from 'i18next'
import { Check } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../lib/cn'
import { colorStyle, PALETTE_LIGHT } from '../lib/colors'

export const colorName = (color: PaletteColor) => t(`colors.${color}`)

/** The palette's hues around a ring: what the custom swatch shows until a colour is chosen. */
const RAINBOW = `conic-gradient(from 210deg, ${[...PALETTE.filter((c) => c !== 'slate'), 'tomato' as const].map((c) => PALETTE_LIGHT[c]).join(', ')})`

type Props =
  | { value: PaletteColor; onChange: (color: PaletteColor) => void; label?: string; custom?: false }
  /** With `custom`, a tenth swatch opens the browser's colour picker for a colour of one's own. */
  | { value: ProjectColor; onChange: (color: ProjectColor) => void; label?: string; custom: true }

export function ColorPicker(props: Props) {
  const { value, onChange, label } = props
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
      {props.custom && <CustomSwatch value={props.value} onChange={props.onChange} />}
    </div>
  )
}

function CustomSwatch({ value, onChange }: { value: ProjectColor; onChange: (color: ProjectColor) => void }) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const chosen = !isPaletteColor(value)
  const look = chosen ? colorStyle(value) : null
  const name = chosen ? t('colors.customValue', { value }) : t('colors.custom')
  // The picker starts from the colour chosen now, as the light theme has it (what is kept): closing it unchanged changes nothing.
  const start = isPaletteColor(value) ? PALETTE_LIGHT[value] : value

  return (
    <span className="group relative grid size-7">
      <button
        type="button"
        role="radio"
        aria-checked={chosen}
        aria-label={name}
        // Keyboards and screen readers reach the swatch, which opens the picker as a tap on it does. On a
        // touch screen (VoiceOver, an iPad's keyboard) it is focus that opens it.
        onClick={() => {
          if (navigator.maxTouchPoints > 0) input.current?.focus({ preventScroll: true })
          input.current?.click()
        }}
        className={cn(
          look?.className,
          'grid size-7 place-items-center rounded-full transition-transform duration-150 group-hover:scale-110',
          // Focus on the picker, which can't be seen, shows on the swatch.
          'group-has-[input:focus-visible]:outline-2 group-has-[input:focus-visible]:outline-offset-2 group-has-[input:focus-visible]:outline-accent',
          chosen && 'ring-2 ring-[var(--c)] ring-offset-2 ring-offset-sheet',
        )}
        style={chosen ? { ...look?.style, background: 'var(--c)' } : { background: RAINBOW }}
      >
        {chosen ? <Check className="size-3.5 text-white" strokeWidth={3} /> : <span className="size-[18px] rounded-full bg-sheet" />}
      </button>
      {/* The browser's own picker, unseen over the swatch: a tap or a click lands on it, which opens it in every
          browser (iPhone's Safari opens no picker it is asked for from script). The swatch is what is focused and read. */}
      <input
        ref={input}
        type="color"
        value={start}
        tabIndex={-1}
        aria-hidden="true"
        title={name}
        className="absolute inset-0 size-full cursor-pointer rounded-full opacity-0"
        onChange={(event) => onChange(event.currentTarget.value.toLowerCase() as ProjectColor)}
      />
    </span>
  )
}
