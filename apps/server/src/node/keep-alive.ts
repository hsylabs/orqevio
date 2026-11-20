import type { Server } from 'node:http'

/** How long an idle connection stays open, past the 60 s that proxies such as Nginx keep theirs. */
export const KEEP_ALIVE_MS = 65_000

/**
 * Node closes an idle connection after 5 s. A proxy that keeps connections to the app open longer
 * (Nginx with `keepalive` towards it) or a client that reuses one (Playwright's request context) can
 * send a request just as the app closes it, and gets a 502 or ECONNRESET. The app waits longer than
 * they do instead; the headers of a request may take a little longer still, as Node requires.
 */
export function keepConnectionsOpen(server: Server) {
  server.keepAliveTimeout = KEEP_ALIVE_MS
  server.headersTimeout = KEEP_ALIVE_MS + 1_000
}
