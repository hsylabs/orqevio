import { type ApiErrorBody, UPLOAD_NAME_HEADER } from '@orqevio/shared'
import { t } from 'i18next'

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
  const headers: Record<string, string> = { Accept: 'application/json' }
  const init: RequestInit = { method, credentials: 'same-origin', signal, headers }
  if (body instanceof Blob) {
    // Files go as the raw body, so the server can stream them to storage.
    init.body = body
    headers['Content-Type'] = body.type || 'application/octet-stream'
    if (body instanceof File) headers[UPLOAD_NAME_HEADER] = encodeURIComponent(body.name)
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  let res: Response
  try {
    res = await fetch(`/api${path}`, init)
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    throw new ApiError(0, 'network', 'No connection to the server')
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

const KNOWN_ERRORS = ['invalid_access_key', 'invalid_setup_code', 'already_claimed', 'not_claimed', 'rate_limited', 'network', 'file_too_large', 'upload_incomplete', 'last_workspace'] as const
const isKnown = (code: string): code is (typeof KNOWN_ERRORS)[number] => (KNOWN_ERRORS as readonly string[]).includes(code)

/** A human-friendly message for any thrown value, in the app's language. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (isKnown(error.code)) return t(`errors:codes.${error.code}`)
    if (error.status === 404) return t('errors:notFound')
    if (error.status >= 500) return t('errors:server')
    // Anything else is a validation detail from the server, which speaks English.
    return error.message
  }
  return t('errors:unknown')
}
