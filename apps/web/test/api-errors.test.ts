import i18next from 'i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ApiError, errorMessage, post } from '../src/lib/api'
import errors from '../src/i18n/locales/es/errors.json'

beforeAll(() => i18next.init({ lng: 'es', resources: { es: { errors } }, ns: ['errors'] }))
afterEach(() => vi.unstubAllGlobals())

describe('too many attempts', () => {
  it('says how long to wait, from the Retry-After the server sends', async () => {
    const body = JSON.stringify({ error: { code: 'rate_limited', message: 'Too many attempts. Try again in 58 min.' } })
    vi.stubGlobal('fetch', async () => new Response(body, { status: 429, headers: { 'Retry-After': '3461', 'Content-Type': 'application/json' } }))
    const error = await post('/auth/login', { accessKey: 'x' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).retryAfter).toBe(3461)
    expect(errorMessage(error)).toBe('Demasiados intentos. Vuelve a intentarlo dentro de 58 minutos.')
    expect(errorMessage(new ApiError(429, 'rate_limited', '', undefined, 30))).toBe('Demasiados intentos. Vuelve a intentarlo dentro de 1 minuto.')
  })

  it('without Retry-After, asks to wait a few minutes as before', () => {
    expect(errorMessage(new ApiError(429, 'rate_limited', ''))).toBe('Demasiados intentos. Espera unos minutos.')
  })
})
