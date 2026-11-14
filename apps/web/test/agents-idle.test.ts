import { describe, expect, it } from 'vitest'
import { idleDays } from '../src/features/agents/TokenCard'

describe('idle agent accesses', () => {
  const now = Date.parse('2026-11-14T12:00:00Z')
  it('are flagged from a week without use, counting whole days', () => {
    expect(idleDays('2026-11-08T12:00:01Z', now)).toBeNull()
    expect(idleDays('2026-11-07T12:00:00Z', now)).toBe(7)
    expect(idleDays('2026-10-15T09:00:00Z', now)).toBe(30)
  })
})
