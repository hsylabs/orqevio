/**
 * Talks to a running copy over HTTP, as its owner: used by `uninstall` to have the copy
 * delete its own data, attachments included, which only the copy can list and delete.
 */

export type EmptyResult =
  | { ok: true; already: boolean }
  | { ok: false; reason: 'not-orqevio' | 'other-copy' | 'wrong-key' | 'unreachable'; detail?: string }

/** The origin of an address the person typed, or null when it is not one. */
export function copyOrigin(address: string) {
  const value = address.trim()
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    return url.protocol === 'https:' || (local && url.protocol === 'http:') ? url.origin : null
  } catch {
    return null
  }
}

/**
 * Signs in to the copy with its access key and asks it to uninstall, as Settings → Uninstall
 * does: every attachment and every row go. The key only travels to the copy, over HTTPS.
 */
export async function emptyCopy(origin: string, name: string, accessKey: string, fetchImpl: typeof fetch = fetch): Promise<EmptyResult> {
  const call = async (path: string, init: RequestInit = {}) => {
    try {
      const res = await fetchImpl(`${origin}${path}`, { ...init, headers: { Accept: 'application/json', ...init.headers }, signal: AbortSignal.timeout(60_000) })
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
      return { res, body }
    } catch (error) {
      return { error: (error as Error).message }
    }
  }
  const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  const session = await call('/api/auth/session')
  if ('error' in session) return { ok: false, reason: 'unreachable', detail: session.error }
  const state = session.body
  if (!session.res.ok || !state || !('claimed' in state || 'user' in state)) return { ok: false, reason: 'not-orqevio' }
  // Older copies do not say their name; one that does must be the copy being removed.
  if (typeof state.copyName === 'string' && state.copyName !== name) return { ok: false, reason: 'other-copy', detail: state.copyName }
  if (state.uninstalled) return { ok: true, already: true }

  const login = await call('/api/auth/login', json({ accessKey }))
  if ('error' in login) return { ok: false, reason: 'unreachable', detail: login.error }
  if (login.res.status === 401 || login.res.status === 403) return { ok: false, reason: 'wrong-key' }
  if (!login.res.ok) return { ok: false, reason: 'unreachable', detail: `HTTP ${login.res.status}` }
  const cookie = login.res.headers
    .getSetCookie()
    .map((line) => line.split(';')[0]!)
    .join('; ')

  const uninstall = await call('/api/account/uninstall', { ...json({ accessKey }), headers: { 'Content-Type': 'application/json', Cookie: cookie } })
  if ('error' in uninstall) return { ok: false, reason: 'unreachable', detail: uninstall.error }
  if (uninstall.res.status === 410) return { ok: true, already: true }
  if (uninstall.res.status === 401 || uninstall.res.status === 403) return { ok: false, reason: 'wrong-key' }
  if (!uninstall.res.ok) return { ok: false, reason: 'unreachable', detail: `HTTP ${uninstall.res.status}` }
  return { ok: true, already: false }
}
