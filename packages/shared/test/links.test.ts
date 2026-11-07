import { describe, expect, it } from 'vitest'
import { extractReferences, markdownToPlainText, parseInternalHref, scopesFromLevels } from '../src'

const a = '0a0e9f0e-1111-4222-8333-944445555666'
const b = '1b1e9f0e-1111-4222-8333-944445555666'

describe('links', () => {
  it('extracts card and doc references once each', () => {
    const md = `See [Fix](/card/${a}) and [again](/card/${a}) plus [Spec](/doc/${b} "t") and [ext](https://x.dev/card/${b}).`
    expect(extractReferences(md)).toEqual({ cards: [a], docs: [b] })
  })
  it('parses internal hrefs strictly', () => {
    expect(parseInternalHref(`/card/${a}`)).toEqual({ type: 'card', id: a })
    expect(parseInternalHref(`/doc/${a}/x`)).toBeNull()
    expect(parseInternalHref('javascript:alert(1)')).toBeNull()
  })
  it('converts markdown to plain text', () => {
    expect(markdownToPlainText('# Title\n\n- [x] **done** [link](/x)\n\n```js\ncode\n```')).toBe('Title done link')
  })
  it('maps access levels to scopes', () => {
    expect(scopesFromLevels({ tasks: 'write', docs: 'read' })).toEqual(['tasks:read', 'tasks:write', 'docs:read'])
    expect(scopesFromLevels({ tasks: 'none', docs: 'none' })).toEqual([])
  })
})
