/**
 * What a browser reports as an error although nothing failed for the person using the app. Kept
 * apart from helpers.ts, without Playwright, so that the unit tests can check it.
 */

/** A request WebKit refused because the page was being left, and when it said so. */
export type Refusal = { text: string; at: number }

/**
 * WebKit refuses a request that a page starts while it is being left (a reload, a goto, a link that
 * loads a whole page), and reports it as an uncaught «Fetch API cannot load <url> due to access
 * control checks.», even when the page catches the rejection. Playwright hands it over as a page
 * error split at the colon of the URL: the name «Fetch API cannot load http» and the message
 * «/localhost:3000/api/… due to access control checks.». Only such a refusal of a request to the
 * copy's own API is matched; anything else is an error.
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
 * The refusals that no navigation of the page explains: WebKit reports one just before the page it
 * left gives way to the next, so a navigation of the main frame follows it within moments. One
 * with no navigation around it is reported as the error it would be.
 */
export const unexplainedRefusals = (refusals: Refusal[], navigations: number[]) =>
  refusals.filter(({ at }) => !navigations.some((navigated) => navigated >= at - 1_000 && navigated <= at + 5_000))
