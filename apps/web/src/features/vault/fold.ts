/** Letters with no accent to take off, written as people type them without it. */
const PLAIN: Record<string, string> = { ß: 'ss', œ: 'oe', æ: 'ae', ø: 'o', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i', ħ: 'h' }
/** For searching: lower case, without accents (`Música` is found as `musica`, `Straße` as `strasse`). */
export const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[ßœæøłđðþıħ]/g, (c) => PLAIN[c]!)
