import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/**
 * Japanese, Chinese and Korean are typed through an input method: a key can belong to the
 * conversion, as the Enter that accepts «日本» for «nihon» or the Escape that drops it, and then it
 * is not meant for the field. Chrome and Firefox mark such a key as composing; Safari sends the
 * Enter once the conversion has ended, marked only by its key code, 229.
 */
export function isConverting(event: KeyboardEvent | ReactKeyboardEvent) {
  const key = 'nativeEvent' in event ? event.nativeEvent : event
  return key.isComposing || key.keyCode === 229
}

/**
 * For a dialog, a sheet or a popover, which closes on Escape anywhere in it: the Escape that drops
 * a conversion in one of its fields leaves it open, and so does one pressed in something that
 * takes Escape as its own (`data-own-escape`), as the bar of a table, from which Escape goes back
 * to the text.
 */
export function keepOpenOnOwnEscape(event: KeyboardEvent) {
  const target = event.target as { closest?: (selector: string) => unknown } | null
  if (isConverting(event) || target?.closest?.('[data-own-escape]')) event.preventDefault()
}
