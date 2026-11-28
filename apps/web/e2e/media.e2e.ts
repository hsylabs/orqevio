import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { createProject, expect, openNewWorkspace, test } from './helpers'

// A video or a sound attached here plays where it is linked, alone on its line, as Notion plays
// one; its Markdown stays the link, which GitHub shows as one. Only this copy's own attachments.

const fixture = (name: string) => readFileSync(path.join(process.cwd(), 'e2e/fixtures', name))
/** 2 s of a test picture, in WebM: what every engine here plays (Chromium has no H.264). */
const CLIP = { name: 'clip.webm', mimeType: 'video/webm', buffer: fixture('clip.webm') }
/** 1 s of a tone, in WAV. */
const TONE = { name: 'nota.wav', mimeType: 'audio/wav', buffer: fixture('nota.wav') }

async function newPage(page: Page, name: string, content = '') {
  const workspace = (await (await page.request.post('/api/workspaces', { data: { name } })).json()) as { id: string }
  const project = (await (await page.request.post(`/api/workspaces/${workspace.id}/projects`, { data: { name: 'Notas' } })).json()) as { id: string }
  const created = await page.request.post(`/api/projects/${project.id}/pages`, { data: { title: 'Medios', content } })
  expect(created.status(), await created.text()).toBe(201)
  const pageId = ((await created.json()) as { id: string }).id
  const saved = async () => ((await (await page.request.get(`/api/pages/${pageId}`)).json()) as { content: string }).content.trim()
  const open = async () => {
    await page.goto(`/w/${workspace.id}/d/${pageId}`)
    const editor = page.getByRole('textbox', { name: 'Contenido de la página' })
    await expect(editor).toBeVisible()
    return editor
  }
  return { pageId, saved, open }
}

async function uploadTo(page: Page, pageId: string, file: typeof CLIP) {
  const uploaded = await page.request.post(`/api/pages/${pageId}/attachments`, { headers: { 'Content-Type': file.mimeType, 'X-File-Name': file.name }, data: file.buffer })
  expect(uploaded.status(), await uploaded.text()).toBe(201)
  return ((await uploaded.json()) as { url: string }).url
}

/** Once its first picture or sound can be played: what it plays, as the browser read it. */
const loaded = (media: Locator) =>
  expect
    .poll(() => media.evaluate((element: HTMLMediaElement) => ({ ready: element.readyState >= 1, duration: Math.round(element.duration), error: element.error?.code ?? null })))
    .toMatchObject({ ready: true, error: null })

/** Once what is shown has settled, as it is seen. */
async function snap(page: Page, path: string) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
  await page.screenshot({ path })
}

test('a video from the «/» menu plays under its link, from any point, and keeps playing while the page is written', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const { saved, open } = await newPage(page, 'Vídeo E2E', 'Antes')
  const editor = await open()
  await editor.getByText('Antes', { exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  // Waited for well before: the browser is told to hand the picker over only after a moment.
  const chooser = page.waitForEvent('filechooser')
  await page.keyboard.type('/video')
  await expect(page.getByRole('option', { name: /Vídeo/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('slash-preview')).toContainText('se reproduce en la página')
  await snap(page, testInfo.outputPath('media-slash-video.png'))
  await page.keyboard.press('Enter')
  const picker = await chooser
  expect(await picker.element().getAttribute('accept')).toBe('video/*')
  await picker.setFiles(CLIP)

  // Its link, as any file's, and its player under it.
  const link = editor.getByRole('link', { name: 'clip.webm', exact: true })
  await expect(link).toBeVisible()
  const video = editor.locator('.orq-media video')
  await expect(video).toHaveAttribute('aria-label', 'Vídeo: clip.webm')
  await loaded(video)
  expect(await video.evaluate((element: HTMLVideoElement) => Math.round(element.duration))).toBe(2)
  await expect.poll(saved).toMatch(/^Antes\n\n\[clip\.webm\]\(\/api\/attachments\/[0-9a-f-]{36}\)$/)
  await snap(page, testInfo.outputPath('media-video.png'))

  // From any point: a piece at a time.
  const seeked = await video.evaluate(
    (element: HTMLVideoElement) =>
      new Promise<number>((resolve) => {
        element.addEventListener('seeked', () => resolve(element.currentTime), { once: true })
        element.currentTime = 1.5
      }),
  )
  expect(seeked).toBeCloseTo(1.5, 0)

  // Playing while the page is written: the same player, still playing.
  await video.evaluate((element: HTMLVideoElement) => {
    element.currentTime = 0
    element.loop = true
    return element.play()
  })
  await editor.getByText('Antes', { exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' y después')
  await expect.poll(saved).toContain('Antes y después')
  expect(await video.evaluate((element: HTMLVideoElement) => ({ connected: element.isConnected, paused: element.paused }))).toEqual({ connected: true, paused: false })

  // A press on its controls is its own: it changes nothing in the page, which is written on after it.
  const written = await saved()
  await video.click()
  await page.waitForTimeout(300)
  expect(await saved()).toBe(written)
  await editor.getByText('Antes y después', { exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.type('!')
  await expect.poll(saved).toContain('Antes y después!')

  // Opened again, it plays from what the page says.
  await page.reload()
  await loaded(page.locator('.orq-media video'))
})

test('a sound plays under its link; one written in a line of text, or not played, stays a link', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const { pageId, saved, open } = await newPage(page, 'Audio E2E')
  const tone = await uploadTo(page, pageId, TONE)
  const report = await uploadTo(page, pageId, { name: 'informe.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') })
  // As an agent writes it, by MCP or the API.
  const content = [`[nota.wav](${tone})`, `Escucha [nota.wav](${tone}) aquí.`, `[informe.pdf](${report})`, `[de fuera](https://example.com${tone})`].join('\n\n')
  expect((await page.request.patch(`/api/pages/${pageId}`, { data: { content, baseVersion: 1 } })).status()).toBe(200)
  const editor = await open()
  const audio = editor.locator('.orq-media audio')
  await expect(audio).toHaveCount(1)
  await expect(audio).toHaveAttribute('aria-label', 'Audio: nota.wav')
  await loaded(audio)
  await expect(editor.getByRole('link')).toHaveCount(4)
  expect(await saved()).toBe(content)
  await snap(page, testInfo.outputPath('media-audio.png'))

  // Changed elsewhere (another tab, an agent): the page reloads its text, and its sound still plays.
  const current = (await (await page.request.get(`/api/pages/${pageId}`)).json()) as { version: number }
  const changed = await page.request.patch(`/api/pages/${pageId}`, { data: { content: `Desde otra pestaña\n\n${content}`, baseVersion: current.version } })
  expect(changed.status(), await changed.text()).toBe(200)
  await expect(editor.getByText('Desde otra pestaña')).toBeVisible()
  await expect(audio).toHaveCount(1)
  await loaded(audio)

  // From the «/» menu, a sound is picked as one.
  await editor.getByText('aquí.', { exact: false }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  // Waited for well before: the browser is told to hand the picker over only after a moment.
  const chooser = page.waitForEvent('filechooser')
  await page.keyboard.type('/audio')
  await expect(page.getByRole('option', { name: /Audio/ })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  const picker = await chooser
  expect(await picker.element().getAttribute('accept')).toBe('audio/*')
  await picker.setFiles(TONE)
  await expect(audio).toHaveCount(2)
})

test('in a comment, a video of the card plays under its link', async ({ page }, testInfo) => {
  const workspaceId = await openNewWorkspace(page, 'Vídeo comentario E2E')
  const boardId = await createProject(page, 'Notas')
  const columns = ((await (await page.request.get(`/api/boards/${boardId}`)).json()) as { columns: Array<{ id: string }> }).columns
  const card = (await (await page.request.post(`/api/columns/${columns[0]!.id}/cards`, { data: { title: 'Grabación' } })).json()) as { id: string }
  const uploaded = await page.request.post(`/api/cards/${card.id}/attachments`, { headers: { 'Content-Type': CLIP.mimeType, 'X-File-Name': CLIP.name }, data: CLIP.buffer })
  const url = ((await uploaded.json()) as { url: string }).url
  await page.request.post(`/api/cards/${card.id}/comments`, { data: { body: `Así queda:\n\n[clip.webm](${url})` } })
  await page.request.patch(`/api/cards/${card.id}`, { data: { description: `La grabación:\n\n[clip.webm](${url})` } })
  await page.goto(`/w/${workspaceId}/b/${boardId}?card=${card.id}`)
  const comment = page.locator('.orq-prose--note').filter({ hasText: 'Así queda:' })
  await loaded(comment.locator('.orq-media video'))
  await expect(comment.getByRole('link', { name: 'clip.webm' })).toBeVisible()
  // And in its description, being edited.
  await loaded(page.getByRole('textbox', { name: 'Descripción de la tarjeta' }).locator('.orq-media video'))
  await comment.screenshot({ path: testInfo.outputPath('media-comment.png') })
})
