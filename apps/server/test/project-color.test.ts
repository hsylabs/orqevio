import { strFromU8, unzipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Harness, ORIGIN, createHarness, signUp } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => h.close())

describe('a project colour of its own', () => {
  it('is kept as #rrggbb in lower case, changes to and from the palette, and goes out in the export', async () => {
    const { client, workspaceId } = await signUp(h)
    const made = await client.post(`/api/workspaces/${workspaceId}/projects`, { name: 'Mudanza', color: '#61BD4F' })
    expect(made.status).toBe(201)
    expect(made.body.color).toBe('#61bd4f')

    expect((await client.patch(`/api/projects/${made.body.id}`, { color: 'jade' })).body.color).toBe('jade')
    expect((await client.patch(`/api/projects/${made.body.id}`, { color: '#0B1F3A' })).body.color).toBe('#0b1f3a')
    const overview = (await client.get(`/api/workspaces/${workspaceId}/overview`)).body
    expect(overview.projects.find((p: { id: string }) => p.id === made.body.id).color).toBe('#0b1f3a')

    // Anything else is refused, and the colour stays as it was.
    for (const color of ['green', '#0b1f3', '#0b1f3a00', 'rgb(11, 31, 58)', 'url(x)', '#0b1f3a;color:red']) {
      expect((await client.patch(`/api/projects/${made.body.id}`, { color })).status, color).toBe(400)
      expect((await client.post(`/api/workspaces/${workspaceId}/projects`, { name: 'Otro', color })).status, color).toBe(400)
    }
    const board = (await client.post(`/api/projects/${made.body.id}/boards`, { name: 'Tareas' })).body.id as string
    expect((await client.get(`/api/boards/${board}`)).body.project.color).toBe('#0b1f3a')

    // Labels keep to the palette.
    expect((await client.post(`/api/boards/${board}/labels`, { name: 'Urgente', color: '#ff0000' })).status).toBe(400)

    const res = await h.app.request('/api/export', { headers: { Cookie: client.cookie, Origin: ORIGIN } })
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
    const tasks = Object.entries(files).find(([name]) => name.endsWith('/tasks.json'))!
    expect(JSON.parse(strFromU8(tasks[1])).projects.find((p: { name: string }) => p.name === 'Mudanza').color).toBe('#0b1f3a')
  })
})
