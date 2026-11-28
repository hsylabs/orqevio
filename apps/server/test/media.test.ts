import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { byteRange } from '../src/lib/byte-range'
import { type Harness, createHarness, seedBoard, signUp } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(() => h.close())

// A video or a sound attached to a page plays where it is linked: sent with its own type, and a
// piece at a time, which Safari asks for to play any video at all.

async function upload(name: string, type: string, bytes: Uint8Array) {
  const { client, workspaceId } = await signUp(h)
  const { projectId } = await seedBoard(client, workspaceId)
  const page = await client.post(`/api/projects/${projectId}/pages`, { title: 'Medios' })
  const up = await client.upload(`/api/pages/${page.body.id}/attachments`, bytes, { name, type })
  expect(up.status).toBe(201)
  const get = (headers: Record<string, string> = {}) => h.app.request(up.body.url as string, { headers: { Cookie: client.cookie, ...headers } })
  return { body: up.body, get }
}

/** 0, 1, 2… as bytes: each byte says where it is. */
const counting = (length: number) => Uint8Array.from({ length }, (_, i) => i % 256)

describe('a video or a sound', () => {
  it('is sent with its own type, to be played, still a download opened on its own, sandboxed and never sniffed', async () => {
    for (const [name, type] of [
      ['clip.mp4', 'video/mp4'],
      ['clip.webm', 'video/webm'],
      ['nota.mp3', 'audio/mpeg'],
      ['nota.m4a', 'audio/x-m4a'],
      ['nota.wav', 'audio/wav'],
    ] as const) {
      const { body, get } = await upload(name, type, counting(64))
      expect(body).toMatchObject({ mimeType: type, isImage: false })
      const res = await get()
      expect(res.status, name).toBe(200)
      expect(res.headers.get('content-type')).toBe(type)
      // Opened on its own, a page made to play it couldn't load it (this CSP): it is downloaded.
      expect(res.headers.get('content-disposition')).toMatch(/^attachment/)
      expect(res.headers.get('accept-ranges')).toBe('bytes')
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
    }
  })

  it('is sent a piece at a time, as asked for', async () => {
    const { get } = await upload('clip.mp4', 'video/mp4', counting(1000))
    const piece = async (range: string) => {
      const res = await get({ Range: range })
      return { status: res.status, length: res.headers.get('content-length'), range: res.headers.get('content-range'), bytes: [...new Uint8Array(await res.arrayBuffer())] }
    }
    // Safari's first question: its first two bytes.
    expect(await piece('bytes=0-1')).toEqual({ status: 206, length: '2', range: 'bytes 0-1/1000', bytes: [0, 1] })
    expect(await piece('bytes=998-')).toEqual({ status: 206, length: '2', range: 'bytes 998-999/1000', bytes: [998 % 256, 999 % 256] })
    expect(await piece('bytes=-3')).toEqual({ status: 206, length: '3', range: 'bytes 997-999/1000', bytes: [997 % 256, 998 % 256, 999 % 256] })
    // Past its end: up to it.
    expect((await piece('bytes=990-5000')).range).toBe('bytes 990-999/1000')
    // Beyond it: nothing to give.
    const beyond = await get({ Range: 'bytes=1000-' })
    expect(beyond.status).toBe(416)
    expect(beyond.headers.get('content-range')).toBe('bytes */1000')
    // Several ranges, or one written wrong: the whole file.
    for (const range of ['bytes=0-1,5-6', 'bytes=5-2', 'items=0-1', 'bytes=-']) {
      const whole = await piece(range)
      expect([whole.status, whole.length, whole.range, whole.bytes.length], range).toEqual([200, '1000', null, 1000])
    }
  })
})

describe('any other file', () => {
  it('is still a download, also a PDF, and can be asked for a piece at a time', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7\n' + 'x'.repeat(100))
    const { body, get } = await upload('informe.pdf', 'application/pdf', pdf)
    expect(body.mimeType).toBe('application/pdf')
    const res = await get()
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment/)
    const piece = await get({ Range: 'bytes=0-3' })
    expect(piece.status).toBe(206)
    expect(new TextDecoder().decode(await piece.arrayBuffer())).toBe('%PDF')
  })

  it('declared as a video but a picture is a picture, as it was: shown in its place', async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    const { body, get } = await upload('falso.mp4', 'video/mp4', png)
    expect(body).toMatchObject({ mimeType: 'image/png', isImage: true })
    const res = await get()
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('content-disposition')).toMatch(/^inline/)
  })
})

describe('a byte range', () => {
  it('is read as HTTP writes it', () => {
    expect(byteRange(undefined, 10)).toBeNull()
    expect(byteRange('bytes=2-4', 10)).toEqual({ start: 2, end: 4 })
    expect(byteRange(' bytes=0- ', 10)).toEqual({ start: 0, end: 9 })
    expect(byteRange('bytes=-20', 10)).toEqual({ start: 0, end: 9 })
    expect(byteRange('bytes=-0', 10)).toBe('unsatisfiable')
    expect(byteRange('bytes=10-12', 10)).toBe('unsatisfiable')
    expect(byteRange('bytes=4-2', 10)).toBeNull()
  })
})
