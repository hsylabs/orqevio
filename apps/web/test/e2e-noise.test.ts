import { describe, expect, it } from 'vitest'
import { cancelledFontLoad, refusedRequest, unexplainedRefusals } from '../e2e/browser-noise'

const origin = 'http://localhost:3000'

describe('a request WebKit refused as the page was left', () => {
  it('is recognised as WebKit logs it and as Playwright hands it over, split at the colon of the URL', () => {
    expect(refusedRequest('Fetch API cannot load http://localhost:3000/api/boards/0b13 due to access control checks.', origin)).toBe(true)
    expect(refusedRequest('Fetch API cannot load http: /localhost:3000/api/boards/0b13 due to access control checks.', origin)).toBe(true)
    expect(refusedRequest('Fetch API cannot load http: //localhost:3000/api/auth/session?x=1 due to access control checks.', origin)).toBe(true)
    expect(refusedRequest('Fetch API cannot load https: /copia.example/api/x due to access control checks.', 'https://copia.example')).toBe(true)
  })

  it('is only a request to the API of the copy under test', () => {
    expect(refusedRequest('Fetch API cannot load http://localhost:3000/assets/index.js due to access control checks.', origin)).toBe(false)
    expect(refusedRequest('Fetch API cannot load https://elsewhere.example/api/x due to access control checks.', origin)).toBe(false)
    expect(refusedRequest('Fetch API cannot load http://localhost:4000/api/x due to access control checks.', origin)).toBe(false)
    expect(refusedRequest('Fetch API cannot load http://localhost:3000/api due to access control checks.', origin)).toBe(false)
    expect(refusedRequest('Fetch API cannot load http://localhost:3000/apix/y due to access control checks.', origin)).toBe(false)
  })

  it('is not any other error', () => {
    expect(refusedRequest('TypeError: Load failed', origin)).toBe(false)
    expect(refusedRequest('Error: No connection to the server', origin)).toBe(false)
    expect(refusedRequest('Fetch API cannot load http://localhost:3000/api/x due to something else.', origin)).toBe(false)
    expect(refusedRequest('Fetch API cannot load not-a-url due to access control checks.', origin)).toBe(false)
  })

  it('counts as an error unless a new document loaded right after it, or just before', () => {
    const refusals = [
      { text: 'followed by a navigation', at: 10_000 },
      { text: 'just after one', at: 20_500 },
      { text: 'alone', at: 40_000 },
    ]
    expect(unexplainedRefusals(refusals, [10_300, 20_000]).map((r) => r.text)).toEqual(['alone'])
    expect(unexplainedRefusals(refusals, [46_000]).map((r) => r.text)).toEqual(['followed by a navigation', 'just after one', 'alone'])
  })

  it('is explained by a load from one second before to five after, both included', () => {
    const at = (time: number) => unexplainedRefusals([{ text: 'x', at: 10_000 }], [time]).length
    expect([at(9_000), at(15_000), at(8_999), at(15_001)]).toEqual([0, 0, 1, 1])
  })
})

describe('a font download Firefox called off', () => {
  it('is that one message, with that status, as Playwright hands it over', () => {
    expect(cancelledFontLoad('[JavaScript Error: "downloadable font: download failed (font-family: "Fraunces" style:normal weight:400 stretch:100 src index:0): status=2152398850 source: http://localhost:3000/fonts/x.woff2"]')).toBe(true)
    expect(cancelledFontLoad('[JavaScript Error: "downloadable font: download failed (font-family: "Fraunces"): status=2147746065"]')).toBe(false)
    expect(cancelledFontLoad('downloadable font: rejected by sanitizer')).toBe(false)
  })
})
