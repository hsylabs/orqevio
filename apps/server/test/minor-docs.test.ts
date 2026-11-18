import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Harness, createHarness, seedBoard, signUp } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => h.close())

async function newPage(title: string) {
  const { client, workspaceId } = await signUp(h)
  const { projectId } = await seedBoard(client, workspaceId)
  const page = await client.post(`/api/projects/${projectId}/pages`, { title })
  return { client, workspaceId, pageId: page.body.id as string, url: `/api/pages/${page.body.id}/attachments` }
}

describe('small fixes in documents and attachments', () => {
  it('recognises AVIF images, which are shown like the other images', async () => {
    const { client, url } = await newPage('AVIF')
    // `ftyp` box with the `avif` brand.
    const avif = Uint8Array.from([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0])
    const up = await client.upload(url, avif, { name: 'foto.avif', type: 'image/avif' })
    expect(up.status).toBe(201)
    expect(up.body).toMatchObject({ mimeType: 'image/avif', isImage: true })
    const download = await h.app.request(up.body.url, { headers: { Cookie: client.cookie } })
    expect(download.headers.get('content-type')).toBe('image/avif')
    // Something that only says it is AVIF is not shown as an image.
    const fake = await client.upload(url, 'not an image at all', { name: 'falsa.avif', type: 'image/avif' })
    expect(fake.body).toMatchObject({ mimeType: 'application/octet-stream', isImage: false })
  })

  it('a long name is cut keeping its extension', async () => {
    const { client, url } = await newPage('Nombres largos')
    const up = await client.upload(url, 'pdf', { name: `${'informe '.repeat(30)}final.pdf` })
    expect(up.body.filename.length).toBeLessThanOrEqual(180)
    expect(up.body.filename.endsWith('.pdf')).toBe(true)
  })

  it('names with quotes and brackets download with that name, and with a plain one for older clients', async () => {
    const { client, url } = await newPage('Descargas')
    const up = await client.upload(url, 'texto', { name: "l'informe (v2) ñ*.txt", type: 'text/plain' })
    const download = await h.app.request(up.body.url, { headers: { Cookie: client.cookie } })
    expect(download.headers.get('content-disposition')).toBe(
      `attachment; filename="l'informe (v2) _*.txt"; filename*=UTF-8''l%27informe%20%28v2%29%20%C3%B1%2A.txt`,
    )
  })

  it('a page deleted while a file goes up refuses it and keeps nothing', async () => {
    const { client, workspaceId, pageId, url } = await newPage('Borrada a medias')
    const uploads = path.join(h.env.dataDir, 'uploads', workspaceId)
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new Uint8Array(50))
        await held
        controller.enqueue(new Uint8Array(50))
        controller.close()
      },
    })
    const upload = client.request('POST', url, body, { 'Content-Type': 'application/octet-stream', 'Content-Length': '100', 'X-File-Name': 'tarde.bin' })
    // The upload has begun: the page goes to the trash meanwhile.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect((await client.del(`/api/pages/${pageId}`)).status).toBe(200)
    release()
    const res = await upload
    expect(res.status).toBe(404)
    expect(await readdir(uploads).catch(() => [])).toEqual([])
  })
})
