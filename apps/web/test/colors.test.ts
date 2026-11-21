import { describe, expect, it } from 'vitest'
import { colorStyle, customTones } from '../src/lib/colors'

const channel = (hex: string, i: number) => {
  const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5)
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}
/** The pages a project's colour is drawn on, in the light and the dark theme (`--sheet` in app.css). */
const LIGHT_PAGE = '#fcfbf8'
const DARK_PAGE = '#181715'
/** The palette's own tones (`--c-*` in app.css), light and dark. */
const PALETTE_TONES = {
  light: ['#e5532a', '#d29a12', '#7fa82d', '#2a9668', '#1b93a6', '#3a6ae0', '#7657e0', '#d4468a', '#6b7180'],
  dark: ['#ff7650', '#f0b63a', '#a5cf52', '#46c08c', '#3cbad0', '#6f95ff', '#a08bff', '#f27ab3', '#9aa0ad'],
}
const weakest = (tones: string[], against: string) => Math.min(...tones.map((tone) => contrast(tone, against)))
/** No custom tone is weaker than the weakest of the palette: against the page, or under a white monogram. */
const WEAKEST = {
  light: { page: weakest(PALETTE_TONES.light, LIGHT_PAGE), monogram: weakest(PALETTE_TONES.light, '#ffffff') },
  dark: { page: weakest(PALETTE_TONES.dark, DARK_PAGE), monogram: weakest(PALETTE_TONES.dark, '#ffffff') },
}

describe("a project's own colour", () => {
  it('shows as chosen in the light theme when the palette could have it, and lighter in the dark one', () => {
    for (const hex of ['#3a6ae0', '#2a9668', '#e5532a', '#6b7180'] as const) {
      const { light, dark } = customTones(hex)
      expect(light, hex).toBe(hex)
      expect(luminance(dark), hex).toBeGreaterThan(luminance(light))
    }
  })

  it('stands out from the page and under its monogram in both themes, however light or dark it was chosen', () => {
    for (const hex of ['#ffffff', '#fafafa', '#fff8dc', '#e0ffe0', '#000000', '#0a0a0a', '#101828', '#00ff00', '#ffff00', '#0000ff', '#ff00ff'] as const) {
      const { light, dark } = customTones(hex)
      expect(light).toMatch(/^#[0-9a-f]{6}$/)
      expect(dark).toMatch(/^#[0-9a-f]{6}$/)
      expect(contrast(light, LIGHT_PAGE), `${hex} light ${light}`).toBeGreaterThanOrEqual(WEAKEST.light.page)
      expect(contrast(light, '#ffffff'), `${hex} light ${light}`).toBeGreaterThanOrEqual(WEAKEST.light.monogram)
      expect(contrast(dark, DARK_PAGE), `${hex} dark ${dark}`).toBeGreaterThanOrEqual(WEAKEST.dark.page)
      expect(contrast(dark, '#ffffff'), `${hex} dark ${dark}`).toBeGreaterThanOrEqual(WEAKEST.dark.monogram)
    }
  })

  it('keeps its hue', () => {
    const { light, dark } = customTones('#ffff99')
    for (const tone of [light, dark]) {
      const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(tone.slice(i, i + 2), 16)) as [number, number, number]
      // Still a yellow: red and green well above blue.
      expect(Math.min(r, g), tone).toBeGreaterThan(b + 40)
    }
  })

  it('is drawn with both tones inline, a palette colour with its class', () => {
    expect(colorStyle('jade')).toEqual({ className: 'c-jade' })
    const look = colorStyle('#ffffff')
    expect(look.className).toBe('c-custom')
    expect(look.style).toEqual({ '--c-custom-light': customTones('#ffffff').light, '--c-custom-dark': customTones('#ffffff').dark })
  })
})
