import type { z } from 'zod'
import { fromZod } from './errors'

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data)
  if (!result.success) throw fromZod(result.error)
  return result.data
}
