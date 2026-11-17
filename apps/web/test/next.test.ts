import { describe, expect, it } from 'vitest'
import { internalPath } from '../src/lib/next'

const ORIGIN = 'https://orqevio.example.com'

describe('where signing in leads', () => {
  it('keeps a page of this app, with its query and fragment', () => {
    expect(internalPath('/w/abc/b/def?card=ghi', ORIGIN)).toBe('/w/abc/b/def?card=ghi')
    expect(internalPath('/oauth/authorize?client_id=x&scope=tasks%3Aread#top', ORIGIN)).toBe('/oauth/authorize?client_id=x&scope=tasks%3Aread#top')
    expect(internalPath(`${ORIGIN}/vault`, ORIGIN)).toBe('/vault')
  })

  it('sends anything that leaves this origin to the home screen', () => {
    for (const next of ['https://evil.example', '//evil.example/x', '/\\evil.example', '\\\\evil.example', 'javascript:alert(1)', 'http://orqevio.example.com/vault']) {
      expect(internalPath(next, ORIGIN), next).toBe('/')
    }
  })

  it('goes home without a next', () => {
    expect(internalPath(null, ORIGIN)).toBe('/')
    expect(internalPath('', ORIGIN)).toBe('/')
  })
})
