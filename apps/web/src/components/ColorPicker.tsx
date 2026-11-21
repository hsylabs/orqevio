import { isPaletteColor, PALETTE, type PaletteColor, type ProjectColor } from '@orqevio/shared'
import { t } from 'i18next'
import { Check } from 'lucide-react'
import { type MouseEvent, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../lib/cn'
import { colorStyle } from '../lib/colors'

export const colorName = (color: PaletteColor) => t(`colors.${color}`)

/** The palette's hues around a ring: what the custom swatch shows until a colour is chosen. */
const RAINBOW = 'conic-gradient(from 210deg, #e5532a, #d29a12, #7fa82d, #2a9668, #1b93a6, #3a6ae0, #7657e0, #d4468a, #e5532a)'
/** Where the browser's colour picker starts when nothing else says, the default project colour. */
const START = '#3a6ae0'

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

  function open(event: MouseEvent<HTMLButtonElement>) {
    const picker = input.current
    if (!picker) return
    // It starts from the colour chosen now, as shown: closing it unchanged changes nothing.
    const shown = getComputedStyle(event.currentTarget.closest('[role="radiogroup"]')?.querySelector('[aria-checked="true"]') ?? event.currentTarget)
      .getPropertyValue('--c')
      .trim()
    picker.value = chosen ? value : /^#[0-9a-f]{6}$/i.test(shown) ? shown : START
    try {
      picker.showPicker()
    } catch {
      picker.click()
    }
  }

  return (
    <span className="relative grid size-7">
      <button
        type="button"
        role="radio"
        aria-checked={chosen}
        aria-label={name}
        title={name}
        onClick={open}
        className={cn(
          look?.className,
          'grid size-7 place-items-center rounded-full transition-transform duration-150 hover:scale-110',
          chosen && 'ring-2 ring-[var(--c)] ring-offset-2 ring-offset-sheet',
        )}
        style={chosen ? { ...look?.style, background: 'var(--c)' } : { background: RAINBOW }}
      >
        {chosen ? <Check className="size-3.5 text-white" strokeWidth={3} /> : <span className="size-[18px] rounded-full bg-sheet" />}
      </button>
      {/* The browser's own picker, under the swatch so it opens next to it; the swatch is what is focused and read. */}
      <input
        ref={input}
        type="color"
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full opacity-0"
        onChange={(event) => onChange(event.currentTarget.value.toLowerCase() as ProjectColor)}
      />
    </span>
  )
}
