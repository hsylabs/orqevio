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

describe('messages from the server, which speaks English', () => {
  it('are said in the app language when they are about the data, permissions or a change meanwhile', () => {
    expect(errorMessage(new ApiError(400, 'bad_request', 'title: Required', [{ path: 'title', message: 'Required' }]))).toBe(
      'Algún dato no es válido. Revísalo y vuelve a intentarlo.',
    )
    expect(errorMessage(new ApiError(403, 'forbidden', 'This token is not allowed to use this tool'))).toBe('No tienes permiso para hacer esto.')
    expect(errorMessage(new ApiError(409, 'conflict', 'This card was modified since you loaded it'))).toBe(
      'Ha cambiado mientras tanto. Vuelve a cargarlo e inténtalo de nuevo.',
    )
  })
})
