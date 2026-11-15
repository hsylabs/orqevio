/**
 * Clears a copied secret from the clipboard once its time is up, as far as the browser
 * allows. Browsers only let a page write to the clipboard while it has the focus
 * (Chromium) or right after a click or key press (Firefox, Safari), and a page usually
 * can't read it without asking. So, when the time is up:
 *
 * 1. If something else was copied from this page since, there is nothing to clear.
 * 2. If the page never lost the focus, nothing can have been copied elsewhere: clear it.
 * 3. If the clipboard can be read without asking, clear it only if it still holds the secret.
 * 4. Otherwise, ask the person once the page is in front again: a click on the reminder
 *    lets every browser clear it, and never wipes something copied later without them knowing.
 *
 * Only one secret is tracked: copying another one, or anything else, replaces it.
 */

interface Pending {
  value: string
  /** The page lost the focus since the copy: something else may have been copied elsewhere. */
  leftPage: boolean
  /** The time is up; waiting for the page to be in front to act. */
  due: boolean
}

let pending: Pending | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let remind: (() => void) | null = null
let busy = false

const onBlur = () => {
  if (pending) pending.leftPage = true
}
// Copying or cutting from this page replaces the secret in the clipboard.
const onCopy = () => cancelClipboardClear()
const onBack = () => {
  if (pending?.due) void attempt()
}

function listen(on: boolean) {
  const method = on ? 'addEventListener' : 'removeEventListener'
  window[method]('blur', onBlur)
  window[method]('focus', onBack)
  document[method]('visibilitychange', onBack)
  document[method]('copy', onCopy, true)
  document[method]('cut', onCopy, true)
}

function finish() {
  clearTimeout(timer)
  if (pending) listen(false)
  pending = null
  remind = null
}

async function write(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** The clipboard's text, only where the browser lets this page read it without asking; undefined otherwise. */
async function readWithoutAsking(): Promise<string | undefined> {
  try {
    const status = await navigator.permissions?.query({ name: 'clipboard-read' as PermissionName })
    if (status?.state !== 'granted') return undefined
    return await navigator.clipboard.readText()
  } catch {
    return undefined
  }
}

async function attempt() {
  const current = pending
  if (!current || busy || document.visibilityState !== 'visible' || !document.hasFocus()) return
  busy = true
  try {
    if (!current.leftPage && (await write(''))) return finish()
    const held = await readWithoutAsking()
    if (pending !== current) return
    if (held !== undefined && (held !== current.value || (await write('')))) return finish()
    const ask = remind
    finish()
    ask?.()
  } finally {
    busy = false
  }
}

/** Clears `value` from the clipboard after `afterMs`, or calls `ask` when only the person can. */
export function clearClipboardLater(value: string, afterMs: number, ask: () => void) {
  finish()
  pending = { value, leftPage: !document.hasFocus(), due: false }
  remind = ask
  listen(true)
  timer = setTimeout(() => {
    if (!pending) return
    pending.due = true
    void attempt()
  }, afterMs)
}

/** Forgets the secret waiting to be cleared: the clipboard holds something else now. */
export function cancelClipboardClear() {
  finish()
}

/** Clears the clipboard now; call it from a click, so every browser allows it. */
export function clearClipboardNow() {
  finish()
  return write('')
}
