/**
 * The caller's address in X-Forwarded-For, behind `proxies` reverse proxies this copy trusts.
 * Each proxy appends the address it got the request from, so only the last `proxies` entries
 * are vouched for: anything to their left came from the client, who can write what it likes
 * there. Undefined when there is nothing to trust, or fewer entries than proxies (the request
 * did not come through all of them).
 */
export function forwardedClient(header: string | undefined, proxies: number) {
  if (proxies < 1 || !header) return undefined
  const entries = header
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return entries.length >= proxies ? entries[entries.length - proxies] : undefined
}
