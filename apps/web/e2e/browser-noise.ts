/**
 * What a browser reports as an error although nothing failed for the person using the app. Kept
 * apart from helpers.ts, without Playwright, so that the unit tests can check it.
 */

/**
 * Firefox logs a font whose download was cancelled (status NS_BINDING_ABORTED, 0x804B0002) as an
 * error: when the page starts a download or goes elsewhere while a font is still loading. Nothing
 * failed, and the font loads again when needed. Any other font error still counts. Playwright
 * hands the message over wrapped, as `[JavaScript Error: "downloadable font: …"]`.
 */
export const cancelledFontLoad = (text: string) => /\bdownloadable font: download failed \(.*\): status=2152398850\b/.test(text)

/** A request WebKit may have refused because the page was being left, and when it said so. */
export type Refusal = { text: string; at: number }

/**
 * WebKit refuses a request that a page starts while it is being left (a reload, a goto, a link that
 * loads a whole page), and logs «Fetch API cannot load <url> due to access control checks.» as an
 * error of the page's script, even when the page catches the rejection; Playwright hands every such
 * log over as a page error. It also splits the text at its first colon and drops the character
 * after it: the name «Fetch API cannot load http» and the message «/localhost:3000/api/… due to
 * access control checks.». Only such a refusal of a request to the copy's own API is matched;
 * anything else is an error.
 */
export function refusedRequest(text: string, origin: string) {
  const whole = text.replace(/^(Fetch API cannot load https?): \/{1,2}/, '$1://')
  const url = /^Fetch API cannot load (\S+) due to access control checks\.$/.exec(whole)?.[1]
  if (!url) return false
  try {
    const target = new URL(url)
    return target.origin === new URL(origin).origin && target.pathname.startsWith('/api/')
  } catch {
    return false
  }
}

/**
 * The refusals that no new document of the page explains: WebKit reports one just before the next
 * document loads, so its DOMContentLoaded follows within moments. The report and the load reach
 * the test separately, so a load up to a second before counts too. One with no load around it is
 * reported as the error it would be.
 */
export const unexplainedRefusals = (refusals: Refusal[], loads: number[]) =>
  refusals.filter(({ at }) => !loads.some((loaded) => loaded >= at - 1_000 && loaded <= at + 5_000))
