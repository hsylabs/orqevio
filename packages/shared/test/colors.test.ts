import { describe, expect, it } from 'vitest'
import { labelCreateInput, projectCreateInput, projectUpdateInput } from '../src'

describe('a project colour', () => {
  it('is one of the palette, or one of its own as #rrggbb, kept in lower case', () => {
    expect(projectCreateInput.parse({ name: 'A' }).color).toBe('cobalt')
    expect(projectCreateInput.parse({ name: 'A', color: 'jade' }).color).toBe('jade')
    expect(projectCreateInput.parse({ name: 'A', color: '#3A6AE0' }).color).toBe('#3a6ae0')
    expect(projectUpdateInput.parse({ color: ' #ffffff ' }).color).toBe('#ffffff')
  })

  it('is nothing else', () => {
    for (const color of ['red', '#abc', '#3a6ae0ff', '3a6ae0', '#gggggg', 'rgb(0, 0, 0)', '', '#3a6ae0;}', 'Jade']) {
      expect(projectCreateInput.safeParse({ name: 'A', color }).success, color).toBe(false)
    }
  })

  it('is not for labels, which keep to the palette', () => {
    expect(labelCreateInput.safeParse({ name: 'x', color: '#3a6ae0' }).success).toBe(false)
  })
})
