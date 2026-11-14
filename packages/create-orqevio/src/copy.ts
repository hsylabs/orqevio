/**
 * Talks to a running copy over HTTP: used by `uninstall` to have the copy delete its own data,
 * attachments included, which only the copy can list and delete.
 */

export type EmptyResult =
  | { ok: true; already: boolean }
  | { ok: false; reason: 'not-orqevio' | 'other-copy' | 'not-authorized' | 'too-old' | 'unreachable'; detail?: string }

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
 * Asks the copy at `origin` to uninstall itself, as Settings → Uninstall does. The token is
 * the one the installer just set as the ORQEVIO_UNINSTALL_TOKEN secret of the Worker in the
 * chosen account: only that Worker has it, so a copy elsewhere (another account, another
 * name) refuses with `not-authorized`, which is also the answer while the secret is still
 * on its way to the copy.
 */
export async function emptyCopy(origin: string, name: string, token: string, fetchImpl: typeof fetch = fetch): Promise<EmptyResult> {
  const call = async (path: string, init: RequestInit = {}) => {
    try {
      const res = await fetchImpl(`${origin}${path}`, { ...init, headers: { Accept: 'application/json', ...init.headers }, signal: AbortSignal.timeout(60_000) })
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
      return { res, body }
    } catch (error) {
      return { error: (error as Error).message }
    }
  }

  const session = await call('/api/auth/session')
  if ('error' in session) return { ok: false, reason: 'unreachable', detail: session.error }
  const state = session.body
  if (!session.res.ok || !state || !('claimed' in state || 'user' in state)) return { ok: false, reason: 'not-orqevio' }
  // A quick, friendly check; the token is what proves it is the copy of this account.
  if (typeof state.copyName === 'string' && state.copyName !== name) return { ok: false, reason: 'other-copy', detail: state.copyName }
  if (state.uninstalled) return { ok: true, already: true }

  const uninstall = await call('/api/uninstall', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
  if ('error' in uninstall) return { ok: false, reason: 'unreachable', detail: uninstall.error }
  if (uninstall.res.ok) return { ok: true, already: false }
  if (uninstall.res.status === 410) return { ok: true, already: true }
  if (uninstall.res.status === 404) return { ok: false, reason: 'too-old' }
  if (uninstall.res.status === 403) return { ok: false, reason: 'not-authorized' }
  return { ok: false, reason: 'unreachable', detail: `HTTP ${uninstall.res.status}` }
}
