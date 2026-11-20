import { describe, expect, it } from 'vitest'
import { ConfigError } from '../src/env'
import { misconfigured } from '../src/worker/misconfigured'
import { appUrlProblem, workerAppUrls } from '../src/worker/settings'

describe('APP_URL on Cloudflare', () => {
  it('is optional: unset or blank, each visit’s own address is used', () => {
    for (const value of [undefined, '', '  ', ' , ']) {
      expect(workerAppUrls(value)).toEqual([])
      expect(appUrlProblem(value)).toBeNull()
    }
  })

  it('takes full addresses, as on Node, and keeps their origins', () => {
    expect(workerAppUrls('https://orqevio.example.com, http://localhost:8787/app')).toEqual(['https://orqevio.example.com', 'http://localhost:8787'])
    expect(workerAppUrls('https://orqevio.example.com/')).toEqual(['https://orqevio.example.com'])
  })

  it('says what is wrong with one that is not a full https:// or http:// address, instead of failing every request or refusing every write', () => {
    for (const value of ['not a url', 'ftp://bad.example', 'localhost:8803', 'https://ok.example, nope']) {
      expect(() => workerAppUrls(value)).toThrow(ConfigError)
      expect(appUrlProblem(value)).toMatch(/^APP_URL must be full addresses starting with https:\/\/ or http:\/\//)
    }
    expect(appUrlProblem('ftp://bad.example')).toContain('(got "ftp://bad.example")')
  })
})

describe('a copy whose settings are wrong', () => {
  const problem = 'APP_URL must be full addresses starting with https:// or http://, such as https://orqevio.example.com (got "<b>x</b>")'
  const answer = (path: string) => misconfigured(new Request(`https://copy.example.workers.dev${path}`), problem)

  it('answers the API, MCP and OAuth with the reason, as JSON', async () => {
    for (const path of ['/api/auth/session', '/mcp', '/oauth/token', '/.well-known/oauth-authorization-server']) {
      const res = answer(path)
      expect(res.status, path).toBe(503)
      const body = (await res.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('misconfigured')
      expect(body.error.message).toContain('APP_URL must be full addresses')
      expect(body.error.message).toContain('remove it to use the address each visit comes from')
    }
  })

  it('fails its health check, saying why', async () => {
    const res = answer('/healthz')
    expect(res.status).toBe(503)
    expect(await res.text()).toBe(`misconfigured: ${problem}\n`)
  })

  it('shows people a page that says what is wrong and what to do, the value written as text', async () => {
    const res = answer('/w/anything')
    expect(res.status).toBe(503)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
    const html = await res.text()
    expect(html).toContain('<title>Orqevio can&#39;t start</title>'.replace('&#39;', "'"))
    expect(html).toContain('(got &#34;&#60;b&#62;x&#60;/b&#62;&#34;)')
    expect(html).not.toContain('<b>x</b>')
    expect(html).toContain('APP_URL is optional')
  })
})
