/** Curated palette keys shared by labels and projects. Hex values live in the web theme. */
export const PALETTE = ['tomato', 'amber', 'lime', 'jade', 'teal', 'cobalt', 'iris', 'rose', 'slate'] as const
export type PaletteColor = (typeof PALETTE)[number]

/** A colour of one's own, as `#rrggbb` in lower case. Projects can have one; labels keep to the palette. */
export type CustomColor = `#${string}`
export type ProjectColor = PaletteColor | CustomColor

/** What a custom colour looks like once read: six hex digits, in lower case. */
export const CUSTOM_COLOR = /^#[0-9a-f]{6}$/

export const isPaletteColor = (color: string): color is PaletteColor => (PALETTE as readonly string[]).includes(color)
