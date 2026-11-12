import type { ApiErrorBody } from '@orqevio/shared'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** Thin fetch wrapper for the Orqevio API (same-origin, cookie session). */
export async function api<T = unknown>(method: Method, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', signal, headers: { Accept: 'application/json' } }
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) {
    ;(init.headers as Record<string, string>)['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  let res: Response
  try {
    res = await fetch(`/api${path}`, init)
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    throw new ApiError(0, 'network', 'No hay conexión con el servidor')
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const data = text ? safeJson(text) : null
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? res.statusText, err?.details)
  }
  return data as T
}

function safeJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export const get = <T>(path: string, signal?: AbortSignal) => api<T>('GET', path, undefined, signal)
export const post = <T>(path: string, body: unknown = {}) => api<T>('POST', path, body)
export const patch = <T>(path: string, body: unknown) => api<T>('PATCH', path, body)
export const put = <T>(path: string, body: unknown) => api<T>('PUT', path, body)
export const del = <T>(path: string) => api<T>('DELETE', path)

/** Spanish, human-friendly message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const known: Record<string, string> = {
      invalid_access_key: 'La clave de acceso no es correcta.',
      invalid_setup_code: 'El código de configuración no es correcto.',
      already_claimed: 'Esta copia ya está configurada. Entra con tu clave de acceso.',
      not_claimed: 'Esta copia aún no está configurada.',
      rate_limited: 'Demasiados intentos. Espera unos minutos.',
      network: 'No hay conexión con el servidor.',
      file_too_large: 'El archivo supera el tamaño máximo permitido.',
      last_workspace: 'Necesitas conservar al menos un espacio.',
    }
    if (known[error.code]) return known[error.code]!
    if (error.status === 404) return 'No se ha encontrado el elemento.'
    if (error.status >= 500) return 'Algo ha fallado en el servidor. Inténtalo de nuevo.'
    return error.message
  }
  return 'Algo ha fallado. Inténtalo de nuevo.'
}
