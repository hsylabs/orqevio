import type { ZodError } from 'zod'

export class AppError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 411 | 413 | 415 | 429 | 500,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'bad_request', message, details)
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'unauthorized', message)
export const forbidden = (message = 'Not allowed', code = 'forbidden') => new AppError(403, code, message)
/** Also used when the caller lacks access, so existence is never leaked. */
export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found`)
export const conflict = (message: string, details?: unknown) => new AppError(409, 'conflict', message, details)
export const uninstalled = () => new AppError(410, 'uninstalled', 'This copy of Orqevio was uninstalled')

export function fromZod(error: ZodError) {
  const issues = error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
  const first = issues[0]
  return badRequest(first ? `${first.path || 'input'}: ${first.message}` : 'Invalid input', issues)
}
