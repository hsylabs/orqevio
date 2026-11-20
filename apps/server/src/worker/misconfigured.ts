/**
 * What a copy answers while its settings are wrong (APP_URL that is not a full address): every
 * request, the same explanation and what to do, instead of a bare error or writes refused for no
 * reason anyone can see. 503: nothing is served until the setting is fixed.
 */
export function misconfigured(request: Request, problem: string) {
  const fix = 'On Cloudflare APP_URL is optional: remove it to use the address each visit comes from, or set it to full addresses separated by commas.'
  const { pathname } = new URL(request.url)
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  if (/^\/(?:api\/|mcp$|oauth\/|\.well-known\/)/.test(pathname)) {
    return Response.json({ error: { code: 'misconfigured', message: `${problem} ${fix}` } }, { status: 503, headers })
  }
  if (pathname === '/healthz') return new Response(`misconfigured: ${problem}\n`, { status: 503, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } })
  const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
  const page = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Orqevio can't start</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#1f1d1a;background:#faf9f6}h1{font-size:1.5rem}code{background:#efede8;padding:.1em .3em;border-radius:4px}</style></head>
<body><h1>Orqevio can't start</h1><p>${escape(problem)}</p><p>${escape(fix)}</p></body>
</html>
`
  return new Response(page, { status: 503, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } })
}
