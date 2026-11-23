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
