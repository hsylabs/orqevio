import { rm } from 'node:fs/promises'
import path from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, type Harness, ORIGIN, createHarness, seedBoard, signUp } from './harness'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => h.close())

/** Downloads a page as the browser does, with the session's cookie or an agent's token. */
async function download(who: Client | string, pageId: string, subpages = false) {
  const auth: Record<string, string> = typeof who === 'string' ? { Authorization: `Bearer ${who}` } : { Cookie: who.cookie }
  const res = await h.app.request(`/api/pages/${pageId}/download${subpages ? '?subpages=1' : ''}`, { headers: { ...auth, Origin: ORIGIN } })
  const bytes = new Uint8Array(await res.arrayBuffer())
  const type = res.headers.get('content-type') ?? ''
  return {
    res,
    disposition: res.headers.get('content-disposition') ?? '',
    text: type.startsWith('text/markdown') ? strFromU8(bytes) : null,
    files: type === 'application/zip' ? unzipSync(bytes) : null,
  }
}

const page = async (client: Client, projectId: string, title: string, parentId?: string) => (await client.post(`/api/projects/${projectId}/pages`, { title, parentId: parentId ?? null })).body.id as string
async function write(client: Client, pageId: string, content: string) {
  const baseVersion = (await client.get(`/api/pages/${pageId}`)).body.version as number
  expect((await client.patch(`/api/pages/${pageId}`, { content, baseVersion })).status).toBe(200)
}

describe('downloading a page', () => {
  it('gives a page that is only text as Markdown, named by its title, with links to the rest pointing at the copy', async () => {
    const { client, workspaceId } = await signUp(h, 'Lucía Martín')
    const { projectId, columns } = await seedBoard(client, workspaceId)
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Contratar' })).body.id as string
    const other = await page(client, projectId, 'Otra')
    const memo = await page(client, projectId, 'Acta: reunión «lunes» ☕')
    await page(client, projectId, 'Subpágina', memo)
    const content = `# Acta\n\nVer [otra](/doc/${other}), [la tarea](/card/${card}) y [esta misma](/doc/${memo}).\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nNo en código: \`/doc/${other}\`\n`
    await write(client, memo, content)

    const { res, text, disposition } = await download(client, memo)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    // Its title as a name every system takes, in UTF-8 and with a plain fallback.
    expect(disposition).toBe(`attachment; filename="Acta- reuni_n _lunes_ _.md"; filename*=UTF-8''${encodeURIComponent('Acta- reunión «lunes» ☕.md')}`)
    expect(text).toBe(content.replace(`(/doc/${other})`, `(${ORIGIN}/doc/${other})`).replace(`(/card/${card})`, `(${ORIGIN}/card/${card})`).replace(`(/doc/${memo})`, '(Acta-%20reuni%C3%B3n%20%C2%ABlunes%C2%BB%20%E2%98%95.md)'))
    // Its subpages stay out unless asked for; asked for, they come with it in a ZIP.
    expect((await download(client, memo, true)).files).not.toBeNull()
  })

  it('puts its files next to it and its subpages in folders, with relative links, as the full export does', async () => {
    const { client, workspaceId } = await signUp(h)
    const { projectId, columns } = await seedBoard(client, workspaceId)
    const card = (await client.post(`/api/columns/${columns[0]!.id}/cards`, { title: 'Contratar' })).body.id as string
    const plan = await page(client, projectId, 'Plan')
    const sub = await page(client, projectId, 'Notas', plan)
    const twin = await page(client, projectId, 'notas', plan)
    const deep = await page(client, projectId, 'Detalle', sub)
    const outside = await page(client, projectId, 'Fuera')
    const photo = (await client.upload(`/api/pages/${plan}/attachments`, 'png', { name: 'foto final.png', type: 'image/png' })).body.id as string
    const again = (await client.upload(`/api/pages/${plan}/attachments`, 'png2', { name: 'foto final.png', type: 'image/png' })).body.id as string
    // A file of a task that the page shows comes along; one of another page that it doesn't, doesn't.
    const budget = (await client.upload(`/api/cards/${card}/attachments`, 'pdf', { name: 'presupuesto.pdf', type: 'application/pdf' })).body.id as string
    await client.upload(`/api/pages/${outside}/attachments`, 'no', { name: 'ajeno.txt', type: 'text/plain' })
    const subFile = (await client.upload(`/api/pages/${deep}/attachments`, 'deep', { name: 'Notas.md', type: 'text/markdown' })).body.id as string
    await write(client, plan, `![](/api/attachments/${photo})\n\n![](/api/attachments/${again})\n\n[Presupuesto](${ORIGIN}/api/attachments/${budget})\n\n[Notas](/doc/${sub}) [Fuera](/doc/${outside}) [Tarea](/card/${card})`)
    await write(client, deep, `[Arriba](/doc/${plan}) ![](/api/attachments/${subFile}) [hermana](/doc/${twin})`)

    const { files, disposition } = await download(client, plan, true)
    expect(disposition).toContain('filename="Plan.zip"')
    expect(Object.keys(files!).sort()).toEqual(
      [
        'Plan.md',
        'Plan (files)/foto final.png',
        'Plan (files)/foto final (2).png',
        'Plan (files)/presupuesto.pdf',
        'Plan/Notas.md',
        'Plan/notas (2).md',
        'Plan/Notas/Detalle.md',
        'Plan/Notas/Detalle (files)/Notas.md',
      ].sort(),
    )
    expect(strFromU8(files!['Plan (files)/foto final (2).png']!)).toBe('png2')
    expect(strFromU8(files!['Plan.md']!)).toBe(
      `![](Plan%20%28files%29/foto%20final.png)\n\n![](Plan%20%28files%29/foto%20final%20%282%29.png)\n\n[Presupuesto](Plan%20%28files%29/presupuesto.pdf)\n\n[Notas](Plan/Notas.md) [Fuera](${ORIGIN}/doc/${outside}) [Tarea](${ORIGIN}/card/${card})`,
    )
    expect(strFromU8(files!['Plan/Notas/Detalle.md']!)).toBe(`[Arriba](../../Plan.md) ![](Detalle%20%28files%29/Notas.md) [hermana](../notas%20%282%29.md)`)

    // Without its subpages: its own files still come, and links to the subpages point at the copy.
    const alone = await download(client, plan)
    expect(Object.keys(alone.files!).sort()).toEqual(['Plan (files)/foto final (2).png', 'Plan (files)/foto final.png', 'Plan (files)/presupuesto.pdf', 'Plan.md'])
    expect(strFromU8(alone.files!['Plan.md']!)).toContain(`[Notas](${ORIGIN}/doc/${sub})`)
  })

  it('leaves out a file gone from storage, and a link to it points at the copy', async () => {
    const { client, workspaceId } = await signUp(h)
    const { projectId } = await seedBoard(client, workspaceId)
    const notes = await page(client, projectId, 'Notas')
    const lost = (await client.upload(`/api/pages/${notes}/attachments`, 'perdido', { name: 'perdido.txt', type: 'text/plain' })).body.id as string
    const [row] = [...h.sql.rows('SELECT storage_key FROM attachments WHERE id = ?', lost)]
    await rm(path.join(h.env.dataDir, 'uploads', String(row![0])))
    // A link that already has an address of its own stays as it was.
    const elsewhere = `https://otra.example/api/attachments/${lost.replace(/^.{8}/, '00000000')}`
    await write(client, notes, `[perdido](/api/attachments/${lost}) [fuera](${elsewhere})`)
    const { text } = await download(client, notes)
    expect(text).toBe(`[perdido](${ORIGIN}/api/attachments/${lost}) [fuera](${elsewhere})`)
  })

  it('is only for people who can read the page: never another workspace, never an agent, and no file from elsewhere', async () => {
    const owner = await signUp(h)
    const { projectId } = await seedBoard(owner.client, owner.workspaceId)
    const secret = await page(owner.client, projectId, 'Secreto')
    const hidden = (await owner.client.upload(`/api/pages/${secret}/attachments`, 'privado', { name: 'privado.txt', type: 'text/plain' })).body.id as string

    const stranger = await signUp(h, 'Otra Persona')
    expect((await download(stranger.client, secret)).res.status).toBe(404)
    const token = (await owner.client.post('/api/tokens', { name: 'Claude', workspaceId: owner.workspaceId, scopes: ['docs:read'], expiresInDays: 30 })).body.token as string
    expect((await download(token, secret)).res.status).toBe(403)
    expect((await download(owner.client, '00000000-0000-4000-8000-000000000000')).res.status).toBe(404)

    // A link in another workspace's page to this file brings nothing of it along.
    const theirs = await seedBoard(stranger.client, stranger.workspaceId)
    const mine = await page(stranger.client, theirs.projectId, 'Mía')
    await write(stranger.client, mine, `![](/api/attachments/${hidden})`)
    const { text } = await download(stranger.client, mine)
    expect(text).toBe(`![](${ORIGIN}/api/attachments/${hidden})`)
  })
})
