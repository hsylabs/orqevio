/** Curated palette keys shared by labels and projects. Hex values live in the web theme. */
export const PALETTE = ['tomato', 'amber', 'lime', 'jade', 'teal', 'cobalt', 'iris', 'rose', 'slate'] as const
export type PaletteColor = (typeof PALETTE)[number]
