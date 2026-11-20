/**
 * Where to go after signing in: a page of this app, never another site. `next` comes from the
 * address, so anyone can write it; anything that leaves this origin goes to the home screen.
 */
export function internalPath(next: string | null, origin: string = window.location.origin): string {
  if (!next) return '/'
  try {
    const url = new URL(next, origin)
    if (url.origin !== origin) return '/'
    // `/.//evil.example` is this origin, but its path `//evil.example` would be another site's address.
    if (url.pathname.startsWith('//')) return '/'
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/'
  }
}
