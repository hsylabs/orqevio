import { describe, expect, it } from 'vitest'
import { diffLines, lineStats } from '../src/diff'

const render = (before: string, after: string) =>
  diffLines(before, after)
    .map((l) => `${l.type === 'added' ? '+' : l.type === 'removed' ? '-' : ' '}${l.text}`)
    .join('\n')

describe('diffLines', () => {
  it('keeps what both texts share and marks the lines removed and added', () => {
    expect(render('a\nb\nc\nd', 'a\nx\nc\nd\ne')).toBe([' a', '-b', '+x', ' c', ' d', '+e'].join('\n'))
  })

  it('handles empty texts, identical texts and texts with nothing in common', () => {
    expect(diffLines('', '')).toEqual([])
    expect(render('', 'a\nb')).toBe('+a\n+b')
    expect(render('a\nb', '')).toBe('-a\n-b')
    expect(render('a\nb', 'a\nb')).toBe(' a\n b')
    expect(render('a\nb', 'c')).toBe('-a\n-b\n+c')
  })

  it('finds the shortest list of changes in the middle of a long text', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`)
    const edited = [...lines]
    edited.splice(100, 1, 'changed 100')
    edited.splice(200, 0, 'inserted')
    const out = diffLines(lines.join('\n'), edited.join('\n'))
    expect(out.filter((l) => l.type !== 'same')).toEqual([
      { type: 'removed', text: 'line 100' },
      { type: 'added', text: 'changed 100' },
      { type: 'added', text: 'inserted' },
    ])
    expect(out.filter((l) => l.type !== 'added').map((l) => l.text)).toEqual(lines)
    expect(out.filter((l) => l.type !== 'removed').map((l) => l.text)).toEqual(edited)
  })

  it('shows a middle with too many differences as replaced whole, still in order', () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`).join('\n')
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`).join('\n')
    const out = diffLines(`top\n${a}\nbottom`, `top\n${b}\nbottom`)
    expect(out[0]).toEqual({ type: 'same', text: 'top' })
    expect(out.at(-1)).toEqual({ type: 'same', text: 'bottom' })
    expect(out.filter((l) => l.type === 'removed')).toHaveLength(3000)
    expect(out.filter((l) => l.type === 'added')).toHaveLength(3000)
  })
})

describe('lineStats', () => {
  it('counts the lines added and removed', () => {
    expect(lineStats('a\nb\nc', 'a\nx\nc\nd')).toEqual({ added: 2, removed: 1 })
    expect(lineStats('', 'a')).toEqual({ added: 1, removed: 0 })
    expect(lineStats('a\na', 'a')).toEqual({ added: 0, removed: 1 })
  })
})
