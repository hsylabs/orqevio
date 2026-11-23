import i18next from 'i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ApiError, errorMessage, get, onSessionEnded, post } from '../src/lib/api'
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

describe('a session that ended', () => {
  const answer = (status: number, code: string) => async () => new Response(JSON.stringify({ error: { code, message: 'x' } }), { status, headers: { 'Content-Type': 'application/json' } })

  it('is told to whoever listens when a request is refused for it, and only then', async () => {
    const ended = vi.fn()
    const stop = onSessionEnded(ended)
    try {
      vi.stubGlobal('fetch', answer(401, 'invalid_access_key'))
      await post('/auth/login', { accessKey: 'x' }).catch(() => {})
      vi.stubGlobal('fetch', answer(403, 'forbidden'))
      await get('/vault').catch(() => {})
      expect(ended).not.toHaveBeenCalled()
      vi.stubGlobal('fetch', answer(401, 'unauthorized'))
      await get('/vault').catch(() => {})
      expect(ended).toHaveBeenCalledTimes(1)
    } finally {
      stop()
    }
    await get('/vault').catch(() => {})
    expect(ended).toHaveBeenCalledTimes(1)
  })
})

describe('the message for a session that ended', () => {
  it('says so in the app language, not the server’s English', () => {
    expect(errorMessage(new ApiError(401, 'unauthorized', 'Authentication required'))).toBe('Tu sesión ha terminado. Vuelve a entrar.')
  })
})

describe('an answer cut short', () => {
  /** An answer whose headers came, but whose body could not be read to the end. */
  const cut = (error: Error) => async () => ({ status: 200, ok: true, headers: new Headers(), text: () => Promise.reject(error) }) as unknown as Response

  it('after its headers came is told as no connection, as when nothing came', async () => {
    vi.stubGlobal('fetch', cut(new TypeError('Load failed')))
    const error = await get('/boards/x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('network')
    expect(errorMessage(error)).toBe(errors.codes.network)
  })

  it('because the request was called off is passed on as such', async () => {
    const aborted = new DOMException('The operation was aborted.', 'AbortError')
    vi.stubGlobal('fetch', cut(aborted))
    await expect(get('/boards/x')).rejects.toBe(aborted)
  })
})
