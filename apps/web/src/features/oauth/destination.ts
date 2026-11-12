/** Where the browser goes back to, as the owner should read it. */
export function destination(uri: string) {
  try {
    const url = new URL(uri)
    if (url.protocol === 'https:') return { label: url.hostname, local: false }
    if (url.protocol === 'http:') return { label: `${url.hostname}, en este ordenador`, local: true }
    return { label: `la aplicación «${url.protocol.slice(0, -1)}» de este ordenador`, local: true }
  } catch {
    return { label: uri, local: true }
  }
}
