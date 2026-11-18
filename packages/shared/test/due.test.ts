import { describe, expect, it } from 'vitest'
import { cardUpdateInput, dueDay } from '../src'

describe('due dates', () => {
  it('are the calendar day written, at 12:00 UTC, whatever the time and offset', () => {
    expect(dueDay('2026-11-17')).toBe('2026-11-17T12:00:00.000Z')
    expect(dueDay(' 2026-11-17 ')).toBe('2026-11-17T12:00:00.000Z')
    // Late in the evening west of Greenwich is already the next day in UTC: the day written wins.
    expect(dueDay('2026-11-17T23:30-05:00')).toBe('2026-11-17T12:00:00.000Z')
    expect(dueDay('2026-11-17T00:30+14:00')).toBe('2026-11-17T12:00:00.000Z')
    expect(dueDay('2026-11-17T23:59:59.999Z')).toBe('2026-11-17T12:00:00.000Z')
    expect(dueDay('2026-11-17T08:00+0530')).toBe('2026-11-17T12:00:00.000Z')
    expect(dueDay('2026-11-17T08:00')).toBe('2026-11-17T12:00:00.000Z')
    expect(dueDay('2028-02-29')).toBe('2028-02-29T12:00:00.000Z')
  })

  it('refuse anything else instead of guessing', () => {
    for (const value of ['1', '12', 'tomorrow', '17/11/2026', '2026-11', '2026-02-30', '2027-02-29', '2026-13-01', '2026-11-17T24:00Z', '2026-11-17T10:00+25:00', '2026-11-17 10:00']) {
      expect(dueDay(value), value).toBeNull()
    }
  })

  it('stay within a reasonable range of years', () => {
    expect(dueDay('0000-01-01')).toBeNull()
    expect(dueDay('1899-12-31')).toBeNull()
    expect(dueDay('2200-01-01')).toBeNull()
    expect(dueDay('1900-01-01')).toBe('1900-01-01T12:00:00.000Z')
    expect(dueDay('2199-12-31')).toBe('2199-12-31T12:00:00.000Z')
  })

  it('come out of the card schemas as stored, or as a clear error', () => {
    expect(cardUpdateInput.parse({ dueAt: '2026-11-17T23:30-05:00' }).dueAt).toBe('2026-11-17T12:00:00.000Z')
    expect(cardUpdateInput.parse({ dueAt: null }).dueAt).toBeNull()
    const refused = cardUpdateInput.safeParse({ dueAt: '12' })
    expect(refused.success).toBe(false)
    expect(refused.error?.issues[0]?.message).toBe('Due dates are a day as YYYY-MM-DD, or an ISO 8601 date-time, between 1900 and 2199')
  })
})
