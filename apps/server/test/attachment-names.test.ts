import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { attachments } from '../src/db/schema'
import { ConfigError, parseMaxUpload } from '../src/env'
import { workerMaxUploadBytes } from '../src/lib/upload-limit'
import { type Harness, createHarness, seedBoard, signUp } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(() => h.close())

// U+202E shows what follows from right to left: «‮gnp.exe» reads as «exe.png».
const DISGUISED = '‮gnp.exe'

describe('attachment names that show in another order', () => {
  it('are stored without the characters that turn them around', async () => {
    const { client, workspaceId } = await signUp(h)
    const { projectId } = await seedBoard(client, workspaceId)
    const page = await client.post(`/api/projects/${projectId}/pages`, { title: 'Adjuntos' })
    const up = await client.upload(`/api/pages/${page.body.id}/attachments`, 'MZ', { name: DISGUISED })
    expect(up.status).toBe(201)
    expect(up.body.filename).toBe('gnp.exe')
    const [row] = await h.db.select({ filename: attachments.filename }).from(attachments).where(eq(attachments.id, up.body.id))
    expect(row?.filename).toBe('gnp.exe')
  })

  it('are shown and downloaded without them, also when stored before 1.2.1', async () => {
    const { client, workspaceId } = await signUp(h, 'Bea Ruiz')
    const { projectId } = await seedBoard(client, workspaceId)
    const page = await client.post(`/api/projects/${projectId}/pages`, { title: 'Antiguos' })
    const up = await client.upload(`/api/pages/${page.body.id}/attachments`, 'MZ', { name: 'informe.txt' })
    // As a copy before 1.2.1 stored it: with the isolate and the override.
    await h.db.update(attachments).set({ filename: `factura⁧${DISGUISED}⁩` }).where(eq(attachments.id, up.body.id))

    const detail = await client.get(`/api/pages/${page.body.id}`)
    expect(detail.body.attachments.map((a: { filename: string }) => a.filename)).toEqual(['facturagnp.exe'])
    const download = await h.app.request(up.body.url, { headers: { Cookie: client.cookie } })
    const disposition = download.headers.get('Content-Disposition') ?? ''
    expect(disposition).toContain(`filename*=UTF-8''facturagnp.exe`)
    expect(disposition).not.toMatch(/%E2%80%AE|%E2%81%A7|%E2%81%A9/)
  })
})

describe('MAX_UPLOAD_MB', () => {
  it('is megabytes: 20 when not set, and decimals are fine', () => {
    expect(parseMaxUpload(undefined)).toBe(20 * 1024 * 1024)
    expect(parseMaxUpload('')).toBe(20 * 1024 * 1024)
    expect(parseMaxUpload(' 50 ')).toBe(50 * 1024 * 1024)
    expect(parseMaxUpload('2.5')).toBe(Math.round(2.5 * 1024 * 1024))
  })

  it('stops the copy from starting when set wrong, and says how to write it', () => {
    for (const value of ['20MB', '0', '-5', 'veinte']) {
      expect(() => parseMaxUpload(value)).toThrow(ConfigError)
    }
    expect(() => parseMaxUpload('20MB')).toThrow('MAX_UPLOAD_MB must be a number of megabytes greater than 0, such as 20 (got "20MB")')
  })

  it('on Cloudflare, set wrong, keeps 20 MB and says so once in the log', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      // What the Worker's settings use (worker/env.ts).
      expect(workerMaxUploadBytes('20MB')).toBe(20 * 1024 * 1024)
      expect(workerMaxUploadBytes('20MB')).toBe(20 * 1024 * 1024)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]?.[0]).toContain('MAX_UPLOAD_MB must be a number of megabytes greater than 0')
      expect(workerMaxUploadBytes('8')).toBe(8 * 1024 * 1024)
      expect(workerMaxUploadBytes(undefined)).toBe(20 * 1024 * 1024)
    } finally {
      warn.mockRestore()
    }
  })
})
