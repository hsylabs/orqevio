import { dueDay } from '@orqevio/shared'
import { afterAll, describe, expect, it } from 'vitest'
import { dueToLocalDate, localDateToDue } from '../src/lib/format'

// From the westernmost to the easternmost offset: a due date is the same day for everyone.
const ZONES = ['Pacific/Pago_Pago', 'America/Los_Angeles', 'America/New_York', 'UTC', 'Europe/Madrid', 'Asia/Tokyo', 'Pacific/Kiritimati']
const original = process.env.TZ
afterAll(() => {
  process.env.TZ = original
})

const day = (date: Date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()]

describe('due dates in every time zone', () => {
  it('are tested in zones that really apply here', () => {
    const offsets = ZONES.map((zone) => {
      process.env.TZ = zone
      return new Date(2026, 10, 17).getTimezoneOffset()
    })
    expect(offsets).toEqual([660, 480, 300, 0, -60, -540, -840])
  })

  it('show the day they were given on, whatever offset it was written with', () => {
    const offsets = ['2026-11-17', '2026-11-17T23:30-05:00', '2026-11-17T00:30+14:00', '2026-11-17T23:59Z', '2026-11-17T06:00-11:00']
    for (const zone of ZONES) {
      process.env.TZ = zone
      for (const written of offsets) expect(day(dueToLocalDate(dueDay(written)!)), `${written} in ${zone}`).toEqual([2026, 11, 17])
    }
  })

  it('store the day picked, at any hour of it', () => {
    for (const zone of ZONES) {
      process.env.TZ = zone
      for (const hour of [0, 12, 23]) expect(localDateToDue(new Date(2026, 10, 17, hour, 30)), `${hour}:30 in ${zone}`).toBe('2026-11-17T12:00:00.000Z')
    }
  })
})
