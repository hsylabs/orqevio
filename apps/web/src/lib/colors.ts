import { CUSTOM_COLOR, type CustomColor, isPaletteColor, type PaletteColor, type ProjectColor } from '@orqevio/shared'
import type { CSSProperties } from 'react'

/** The palette's tones for the light theme, as `--c-*` in app.css has them (a test keeps them the same). */
export const PALETTE_LIGHT: Record<PaletteColor, CustomColor> = {
  tomato: '#e5532a',
  amber: '#d29a12',
  lime: '#7fa82d',
  jade: '#2a9668',
  teal: '#1b93a6',
  cobalt: '#3a6ae0',
  iris: '#7657e0',
  rose: '#d4468a',
  slate: '#6b7180',
}

/**
 * A colour of one's own, drawn as the palette is: a tone for the light theme and a lighter one for
 * the dark theme. Each stays within the luminance of the palette's own tones (`--c-*` in app.css),
 * so it stands out from the page and carries a white monogram as well as the palette's weakest do.
 * Only its lightness moves (OKLCH): hue stays, and chroma gives way only as much as the screen's
 * colours (sRGB) need.
 */
const BOUNDS = {
  /** No lighter than amber, the palette's lightest tone for the light theme; as dark as one likes. */
  light: { min: 0, max: PALETTE_LIGHT.amber },
  /** Between cobalt and lime, the palette's darkest and lightest tones for the dark theme. */
  dark: { min: '#6f95ff', max: '#a5cf52' },
} as const
/** How much lighter a palette colour's dark tone is than its light one, on average (OKLCH). */
const DARK_LIFT = 0.11

type Lab = { L: number; a: number; b: number }
type Rgb = [number, number, number]

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
const unit = (c: number) => Math.min(1, Math.max(0, c))

const linearRgb = (hex: string) => [1, 3, 5].map((i) => toLinear(Number.parseInt(hex.slice(i, i + 2), 16) / 255)) as Rgb
/** Relative luminance (WCAG), what contrast is measured with. */
const luminance = ([r, g, b]: Rgb) => 0.2126 * unit(r) + 0.7152 * unit(g) + 0.0722 * unit(b)

function toOklab([r, g, b]: Rgb): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

/** Linear sRGB, which may fall outside 0–1 when the colour is beyond what the screen shows. */
function toLinearRgb({ L, a, b }: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const inGamut = (rgb: Rgb) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4)
const toHex = (rgb: Rgb) => `#${rgb.map((c) => Math.round(unit(fromLinear(unit(c))) * 255).toString(16).padStart(2, '0')).join('')}`

/** The same hue at lightness `L`, with as much of its chroma as the screen can show. */
function atLightness(color: Lab, L: number): Rgb {
  const full = toLinearRgb({ L, a: color.a, b: color.b })
  if (inGamut(full)) return full
  let [low, high] = [0, 1]
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2
    if (inGamut(toLinearRgb({ L, a: color.a * mid, b: color.b * mid }))) low = mid
    else high = mid
  }
  return toLinearRgb({ L, a: color.a * low, b: color.b * low })
}

/** Lightness `L` itself if its luminance is within bounds, or the nearest one that is. */
function within(color: Lab, L: number, bounds: { min: number | string; max: string }): Rgb {
  // A hair inside the bounds, so rounding to whole channel values can't take it out.
  const [min, max] = [bounds.min, bounds.max].map((b, i) => (typeof b === 'number' ? b : luminance(linearRgb(b)) * (i === 0 ? 1.01 : 0.99))) as [number, number]
  const at = (l: number) => luminance(atLightness(color, l))
  // Luminance rises with lightness at a given hue, so the nearest is found by halving.
  const nearest = (low: number, high: number, fits: (l: number) => boolean, keep: 'low' | 'high') => {
    for (let i = 0; i < 24; i++) {
      const mid = (low + high) / 2
      if (fits(mid) === (keep === 'low')) low = mid
      else high = mid
    }
    return keep === 'low' ? low : high
  }
  if (at(L) > max) L = nearest(0, L, (l) => at(l) <= max, 'low')
  else if (at(L) < min) L = nearest(L, 1, (l) => at(l) >= min, 'high')
  return atLightness(color, L)
}

const tones = new Map<string, { light: string; dark: string }>()

/** The tones a custom colour is drawn with, in the light and the dark theme. */
export function customTones(hex: CustomColor): { light: string; dark: string } {
  const known = tones.get(hex)
  if (known) return known
  const rgb = linearRgb(hex)
  const color = toOklab(rgb)
  // The light tone is the colour itself whenever the palette could have it.
  const light = luminance(rgb) <= luminance(linearRgb(BOUNDS.light.max)) ? rgb : within(color, color.L, BOUNDS.light)
  const result = { light: toHex(light), dark: toHex(within(color, toOklab(light).L + DARK_LIFT, BOUNDS.dark)) }
  tones.set(hex, result)
  return result
}

/**
 * How an element takes a project's colour: a palette class, or the custom class with its two
 * tones inline, which the theme picks from (see `.c-custom` in app.css).
 */
export function colorStyle(color: ProjectColor): { className: string; style?: CSSProperties } {
  if (isPaletteColor(color)) return { className: `c-${color}` }
  // Anything else that might be stored is drawn as an unknown colour always was, in slate.
  if (!CUSTOM_COLOR.test(color)) return { className: 'c-slate' }
  const { light, dark } = customTones(color)
  return { className: 'c-custom', style: { '--c-custom-light': light, '--c-custom-dark': dark } as CSSProperties }
}
