// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadFile } from '../src/features/docs/editor/Editor'
import { keys, queryClient } from '../src/lib/queries'

const me = (maxUploadBytes: number | null) => queryClient.setQueryData(keys.me, { user: { id: 'u' }, workspaces: [], limits: { maxUploadBytes } })
const created = () => new Response(JSON.stringify({ id: 'a', filename: 'logo.png', url: '/api/attachments/a' }), { status: 201, headers: { 'Content-Type': 'application/json' } })

describe('the upload limit the app checks first', () => {
  afterEach(() => {
    queryClient.clear()
    vi.unstubAllGlobals()
  })

  it('refuses a file over it before sending anything', async () => {
    const fetch = vi.fn(async () => created())
    vi.stubGlobal('fetch', fetch)
    me(4)
    await expect(uploadFile(new File(['12345'], 'logo.png', { type: 'image/png' }), { type: 'page', id: 'p' })).rejects.toMatchObject({ code: 'file_too_large' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('leaves it to the server when the copy gives no number (MAX_UPLOAD_MB set wrong before 1.2.1)', async () => {
    const fetch = vi.fn(async () => created())
    vi.stubGlobal('fetch', fetch)
    me(null)
    await expect(uploadFile(new File(['png'], 'logo.png', { type: 'image/png' }), { type: 'page', id: 'p' })).resolves.toMatchObject({ id: 'a' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
