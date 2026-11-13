/**
 * Where the browser goes back to, as the owner should read it. Each screen has a
 * whole sentence for every kind, with the name as `{{name}}`:
 * - `plain`: a website, named by its host (or an address that does not parse, as is);
 * - `computer`: a server on this computer, named by its host;
 * - `app`: an app of this computer, named by its URL scheme.
 */
export type Destination = { kind: 'plain' | 'computer' | 'app'; name: string; local: boolean }

export function destination(uri: string): Destination {
  try {
    const url = new URL(uri)
    if (url.protocol === 'https:') return { kind: 'plain', name: url.hostname, local: false }
    if (url.protocol === 'http:') return { kind: 'computer', name: url.hostname, local: true }
    return { kind: 'app', name: url.protocol.slice(0, -1), local: true }
  } catch {
    return { kind: 'plain', name: uri, local: true }
  }
}
