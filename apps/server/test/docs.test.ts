import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Harness, createHarness, seedBoard, signUp } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => h.close())

describe('documents', () => {
  it('creates nested pages, guards concurrent edits and syncs card mentions', async () => {
    const { client, workspaceId } = await signUp(h)
    const { projectId, columns } = await seedBoard(client, workspaceId)
    const card = await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Diseñar landing' })

    const root = await client.post(`/api/projects/${projectId}/pages`, { title: 'Especificación' })
    const child = await client.post(`/api/projects/${projectId}/pages`, { title: 'Detalle', parentId: root.body.id })
    expect(child.status).toBe(201)

    const content = `Ver [Diseñar landing](/card/${card.body.id}) para el estado.`
    const saved = await client.patch(`/api/pages/${root.body.id}`, { content, baseVersion: 1 })
    expect(saved.body.version).toBe(2)

    const stale = await client.patch(`/api/pages/${root.body.id}`, { content: 'old', baseVersion: 1 })
    expect(stale.status).toBe(409)
    expect(stale.body.error.details.currentVersion).toBe(2)
    expect((await client.patch(`/api/pages/${root.body.id}`, { content: 'no version' })).status).toBe(400)
    // Renaming does not bump the content version, so it never conflicts with an open editor.
    const renamed = await client.patch(`/api/pages/${root.body.id}`, { title: 'Especificación' })
    expect(renamed.body.version).toBe(2)

    const page = await client.get(`/api/pages/${root.body.id}`)
    expect(page.body.cards).toEqual([expect.objectContaining({ id: card.body.id, sources: ['mention'] })])
    expect(page.body.children.map((c: { title: string }) => c.title)).toEqual(['Detalle'])
    const childPage = await client.get(`/api/pages/${child.body.id}`)
    expect(childPage.body.breadcrumbs.map((b: { title: string }) => b.title)).toEqual(['Especificación'])

    const cardDetail = await client.get(`/api/cards/${card.body.id}`)
    expect(cardDetail.body.pages).toEqual([expect.objectContaining({ id: root.body.id, sources: ['mention'] })])

    // Manual link on top of the mention; removing the mention keeps the manual one.
    await client.post(`/api/cards/${card.body.id}/pages`, { pageId: root.body.id })
    await client.patch(`/api/pages/${root.body.id}`, { content: 'Sin enlaces', baseVersion: 2 })
    const after = await client.get(`/api/cards/${card.body.id}`)
    expect(after.body.pages[0].sources).toEqual(['manual'])
  })

  it('prevents moving a page inside its own subtree', async () => {
    const { client, workspaceId } = await signUp(h)
    const { projectId } = await seedBoard(client, workspaceId)
    const a = await client.post(`/api/projects/${projectId}/pages`, { title: 'A' })
    const b = await client.post(`/api/projects/${projectId}/pages`, { title: 'B', parentId: a.body.id })
    expect((await client.post(`/api/pages/${a.body.id}/move`, { parentId: b.body.id, index: 0 })).status).toBe(400)
    expect((await client.post(`/api/pages/${b.body.id}/move`, { parentId: null, index: 0 })).status).toBe(204)
    const tree = await client.get(`/api/projects/${projectId}/pages`)
    expect(tree.body.map((p: { title: string }) => p.title)).toEqual(['B', 'A'])
  })

  it('searches cards and pages with excerpts', async () => {
    const { client, workspaceId } = await signUp(h)
    const { projectId, columns } = await seedBoard(client, workspaceId)
    await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Migrar facturación' })
    await client.post(`/api/projects/${projectId}/pages`, { title: 'Notas', content: 'El proceso de facturación mensual empieza el día 1.' })
    const res = await client.get(`/api/workspaces/${workspaceId}/search?q=factura`)
    expect(res.body.map((r: { type: string }) => r.type).sort()).toEqual(['card', 'page'])
    const page = res.body.find((r: { type: string }) => r.type === 'page')
    expect(page.excerpt).toContain('facturación mensual')
    expect((await client.get(`/api/workspaces/${workspaceId}/search?q=%25`)).body).toEqual([])
  })

  it('stores attachments, sniffs their type and protects access', async () => {
    const { client, workspaceId } = await signUp(h)
    const { projectId } = await seedBoard(client, workspaceId)
    const page = await client.post(`/api/projects/${projectId}/pages`, { title: 'Con imagen' })
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    const form = new FormData()
    form.append('file', new File([png], 'pixel.png', { type: 'text/html' }))
    const up = await client.request('POST', `/api/pages/${page.body.id}/attachments`, form)
    expect(up.status).toBe(201)
    expect(up.body.mimeType).toBe('image/png')
    expect(up.body.isImage).toBe(true)

    const svg = new FormData()
    svg.append('file', new File(['<svg onload="alert(1)"/>'], 'x.svg', { type: 'image/svg+xml' }))
    const svgUp = await client.request('POST', `/api/pages/${page.body.id}/attachments`, svg)
    const download = await h.app.request(svgUp.body.url, { headers: { Cookie: client.cookie } })
    expect(download.headers.get('content-type')).toBe('application/octet-stream')
    expect(download.headers.get('content-disposition')).toMatch(/^attachment/)

    const stranger = await signUp(h)
    expect((await stranger.client.get(up.body.url)).status).toBe(404)
  })
})
