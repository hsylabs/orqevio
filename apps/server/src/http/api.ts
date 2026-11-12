import { UPLOAD_NAME_HEADER } from '@orqevio/shared'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { AppError, badRequest } from '../lib/errors'
import { RateLimiter } from '../lib/rate-limit'
import { endpointFor } from './oauth'
import { clearSessionCookie, clientIp, originGuard, requireActor, resolveActor, sessionOnly, setSessionCookie } from './middleware'
import type { Env } from '../env'
import type { Access } from '../services/access'
import type { AppEnv } from './types'

/** File names travel percent-encoded, since HTTP headers only carry ASCII reliably. */
function decodeFileName(header: string | undefined) {
  if (!header) return 'file'
  try {
    return decodeURIComponent(header)
  } catch {
    return 'file'
  }
}

function limit(limiter: RateLimiter, key: string) {
  const wait = limiter.hit(key)
  if (wait > 0) throw new AppError(429, 'rate_limited', `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.`)
}

async function json(c: { req: { json: () => Promise<unknown> } }) {
  try {
    return await c.req.json()
  } catch {
    throw badRequest('The request body must be valid JSON')
  }
}

export function createApi(env: Env) {
  const api = new Hono<AppEnv>()
  // Brute force is hopeless against a 160-bit key, but failed attempts are still slowed down;
  // a success resets the counter.
  const loginLimiter = new RateLimiter(10, 15 * 60 * 1000)
  const setupLimiter = new RateLimiter(10, 60 * 60 * 1000)

  api.use('*', originGuard)
  api.use('*', resolveActor)
  api.use('*', async (c, next) => {
    // Uploads are streamed to storage and checked against MAX_UPLOAD_MB by the attachment service.
    if (c.req.path.endsWith('/attachments') && c.req.method === 'POST') return next()
    return bodyLimit({ maxSize: 2 * 1024 * 1024, onError: () => { throw new AppError(413, 'too_large', 'Request body too large') } })(c, next)
  })
  api.use('*', async (c, next) => {
    await next()
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store')
  })

  // ── Access ──────────────────────────────────────────────────────
  api.post('/auth/claim', async (c) => {
    const key = clientIp(c)
    limit(setupLimiter, key)
    const { user, accessKey, session } = await c.get('services').accounts.claim(await json(c), c.req.header('user-agent') ?? null)
    setupLimiter.reset(key)
    setSessionCookie(c, session.token, session.expiresAt)
    return c.json({ user, accessKey }, 201)
  })
  api.post('/auth/login', async (c) => {
    const key = clientIp(c)
    limit(loginLimiter, key)
    const { user, session } = await c.get('services').accounts.login(await json(c), c.req.header('user-agent') ?? null)
    loginLimiter.reset(key)
    setSessionCookie(c, session.token, session.expiresAt)
    return c.json({ user })
  })
  api.post('/auth/recover', async (c) => {
    const key = clientIp(c)
    limit(setupLimiter, key)
    const { user, accessKey, session } = await c.get('services').accounts.recover(await json(c), c.req.header('user-agent') ?? null)
    setupLimiter.reset(key)
    setSessionCookie(c, session.token, session.expiresAt)
    return c.json({ user, accessKey })
  })
  api.post('/auth/logout', async (c) => {
    const actor = c.get('actor')
    if (actor) await c.get('services').accounts.logout(actor)
    clearSessionCookie(c)
    return c.body(null, 204)
  })
  api.get('/auth/me', async (c) => c.json(await c.get('services').accounts.me(requireActor(c))))
  api.get('/updates', async (c) => c.json(await c.get('services').updates.status(requireActor(c))))
  // Like /auth/me, but answers 200 for visitors: the sign-in screens need to know whether the copy is claimed.
  api.get('/auth/session', async (c) => {
    const actor = c.get('actor')
    if (!actor || actor.kind !== 'user') return c.json({ user: null, workspaces: [], ...(await c.get('services').accounts.state()) })
    return c.json(await c.get('services').accounts.me(actor))
  })

  // ── Account ─────────────────────────────────────────────────────
  api.patch('/account', async (c) => c.json(await c.get('services').accounts.update(requireActor(c), await json(c))))
  api.post('/account/access-key', async (c) => c.json(await c.get('services').accounts.rotateAccessKey(requireActor(c), await json(c))))
  api.post('/account/delete', async (c) => {
    await c.get('services').accounts.remove(requireActor(c), await json(c))
    clearSessionCookie(c)
    return c.body(null, 204)
  })

  // ── Workspaces ──────────────────────────────────────────────────
  api.get('/workspaces', async (c) => c.json(await c.get('services').workspaces.list(requireActor(c))))
  api.post('/workspaces', async (c) => c.json(await c.get('services').workspaces.create(requireActor(c), await json(c)), 201))
  api.patch('/workspaces/:id', async (c) =>
    c.json(await c.get('services').workspaces.update(requireActor(c), c.req.param('id'), await json(c))),
  )
  api.delete('/workspaces/:id', async (c) => {
    await c.get('services').workspaces.remove(requireActor(c), c.req.param('id'))
    return c.body(null, 204)
  })
  api.get('/workspaces/:id/overview', async (c) => c.json(await c.get('services').workspaces.overview(requireActor(c), c.req.param('id'))))
  api.get('/workspaces/:id/home', async (c) => c.json(await c.get('services').workspaces.home(requireActor(c), c.req.param('id'))))
  api.get('/workspaces/:id/search', async (c) => {
    const type = c.req.query('type')
    const types: Array<'card' | 'page'> | undefined = type === 'card' || type === 'page' ? [type] : undefined
    return c.json(await c.get('services').search.search(requireActor(c), c.req.param('id'), c.req.query('q') ?? '', { types }))
  })
  api.get('/workspaces/:id/activity', async (c) => {
    const actor = requireActor(c)
    const services = c.get('services')
    const access: Access = services.access
    await access.workspace(actor, c.req.param('id'))
    access.requireUser(actor)
    const before = c.req.query('before')
    return c.json(
      await services.activity.list(c.req.param('id'), {
        limit: Number(c.req.query('limit') ?? 30),
        before: before ? new Date(before) : undefined,
        tokenId: c.req.query('tokenId') || undefined,
        agentsOnly: c.req.query('agents') === '1',
      }),
    )
  })
  // ── Projects ────────────────────────────────────────────────────
  api.post('/workspaces/:id/projects', async (c) =>
    c.json(await c.get('services').workspaces.createProject(requireActor(c), c.req.param('id'), await json(c)), 201),
  )
  api.patch('/projects/:id', async (c) =>
    c.json(await c.get('services').workspaces.updateProject(requireActor(c), c.req.param('id'), await json(c))),
  )
  api.delete('/projects/:id', async (c) => {
    await c.get('services').workspaces.removeProject(requireActor(c), c.req.param('id'))
    return c.body(null, 204)
  })
  api.post('/projects/:id/boards', async (c) =>
    c.json(await c.get('services').boards.create(requireActor(c), c.req.param('id'), await json(c)), 201),
  )
  api.get('/projects/:id/pages', async (c) => c.json(await c.get('services').pages.tree(requireActor(c), c.req.param('id'))))
  api.post('/projects/:id/pages', async (c) =>
    c.json(await c.get('services').pages.create(requireActor(c), c.req.param('id'), await json(c)), 201),
  )

  // ── Boards, columns, labels ─────────────────────────────────────
  api.get('/boards/:id', async (c) => c.json(await c.get('services').boards.get(requireActor(c), c.req.param('id'))))
  api.patch('/boards/:id', async (c) => {
    await c.get('services').boards.update(requireActor(c), c.req.param('id'), await json(c))
    return c.body(null, 204)
  })
  api.delete('/boards/:id', async (c) => {
    await c.get('services').boards.remove(requireActor(c), c.req.param('id'))
    return c.body(null, 204)
  })
  api.get('/boards/:id/archived', async (c) => c.json(await c.get('services').boards.archived(requireActor(c), c.req.param('id'))))
  api.post('/boards/:id/columns', async (c) =>
    c.json(await c.get('services').boards.createColumn(requireActor(c), c.req.param('id'), await json(c)), 201),
  )
  api.post('/boards/:id/labels', async (c) =>
    c.json(await c.get('services').boards.createLabel(requireActor(c), c.req.param('id'), await json(c)), 201),
  )
  api.patch('/columns/:id', async (c) =>
    c.json(await c.get('services').boards.updateColumn(requireActor(c), c.req.param('id'), await json(c))),
  )
  api.delete('/columns/:id', async (c) => {
    await c.get('services').boards.removeColumn(requireActor(c), c.req.param('id'))
    return c.body(null, 204)
  })
  api.post('/columns/:id/cards', async (c) =>
    c.json(await c.get('services').cards.create(requireActor(c), c.req.param('id'), await json(c)), 201),
  )
  api.patch('/labels/:id', async (c) =>
    c.json(await c.get('services').boards.updateLabel(requireActor(c), c.req.param('id'), await json(c))),
  )
  api.delete('/labels/:id', async (c) => {
    await c.get('services').boards.removeLabel(requireActor(c), c.req.param('id'))
    return c.body(null, 204)
  })

  // ── Cards ───────────────────────────────────────────────────────
  api.get('/cards/:id', async (c) => c.json(await c.get('services').cards.detail(requireActor(c), c.req.param('id'))))
  api.patch('/cards/:id', async (c) => c.json(await c.get('services').cards.update(requireActor(c), c.req.param('id'), await json(c))))
  api.post('/cards/:id/move', async (c) => c.json(await c.get('services').cards.move(requireActor(c), c.req.param('id'), await json(c))))
  api.post('/cards/:id/archive', async (c) => {
    await c.get('services').cards.setArchived(requireActor(c), c.req.param('id'), true)
    return c.body(null, 204)
  })
  api.post('/cards/:id/restore', async (c) => {
    await c.get('services').cards.setArchived(requireActor(c), c.req.param('id'), false)
    return c.body(null, 204)
  })
  api.delete('/cards/:id', async (c) => {
    await c.get('services').cards.remove(requireActor(c), c.req.param('id'))
    return c.body(null, 204)
  })
  api.post('/cards/:id/checklists', async (c) =>
    c.json(await c.get('services').cards.createChecklist(requireActor(c), c.req.param('id'), await json(c)), 201),
  )
  api.patch('/checklists/:id', async (c) => {
    await c.get('services').cards.updateChecklist(requireActor(c), c.req.param('id'), await json(c))
    return c.body(null, 204)
  })
  api.delete('/checklists/:id', async (c) => {
    await c.get('services').cards.removeChecklist(requireActor(c), c.req.param('id'))
    return c.body(null, 204)
  })
  api.post('/checklists/:id/items', async (c) =>
    c.json(await c.get('services').cards.addItem(requireActor(c), c.req.param('id'), await json(c)), 201),
  )
  api.patch('/checklist-items/:id', async (c) =>
    c.json(await c.get('services').cards.updateItem(requireActor(c), c.req.param('id'), await json(c))),
  )
  api.delete('/checklist-items/:id', async (c) => {
    await c.get('services').cards.removeItem(requireActor(c), c.req.param('id'))
    return c.body(null, 204)
  })
  api.post('/cards/:id/pages', async (c) => {
    await c.get('services').cards.linkPage(requireActor(c), c.req.param('id'), await json(c))
    return c.body(null, 204)
  })
  api.delete('/cards/:id/pages/:pageId', async (c) => {
    await c.get('services').cards.unlinkPage(requireActor(c), c.req.param('id'), c.req.param('pageId'))
    return c.body(null, 204)
  })

  // ── Pages ───────────────────────────────────────────────────────
  api.get('/pages/:id', async (c) => c.json(await c.get('services').pages.get(requireActor(c), c.req.param('id'))))
  api.patch('/pages/:id', async (c) => c.json(await c.get('services').pages.update(requireActor(c), c.req.param('id'), await json(c))))
  api.post('/pages/:id/move', async (c) => {
    await c.get('services').pages.move(requireActor(c), c.req.param('id'), await json(c))
    return c.body(null, 204)
  })
  api.delete('/pages/:id', async (c) => {
    await c.get('services').pages.remove(requireActor(c), c.req.param('id'))
    return c.body(null, 204)
  })

  // ── Attachments ─────────────────────────────────────────────────
  for (const [path, target] of [
    ['/pages/:id/attachments', 'pageId'],
    ['/cards/:id/attachments', 'cardId'],
  ] as const) {
    api.post(path, async (c) => {
      const length = c.req.header('content-length')
      const dto = await c.get('services').attachments.upload(requireActor(c), { [target]: c.req.param('id') }, {
        body: c.req.raw.body,
        size: length === undefined || !/^\d+$/.test(length) ? Number.NaN : Number(length),
        name: decodeFileName(c.req.header(UPLOAD_NAME_HEADER)),
        type: c.req.header('content-type') ?? '',
      })
      return c.json(dto, 201)
    })
  }
  api.get('/attachments/:id', async (c) => {
    const { meta, inline, body } = await c.get('services').attachments.open(requireActor(c), c.req.param('id'))
    const encoded = encodeURIComponent(meta.filename)
    return new Response(body, {
      headers: {
        'Content-Type': inline ? meta.mimeType : 'application/octet-stream',
        'Content-Length': String(meta.size),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encoded}`,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    })
  })
  api.delete('/attachments/:id', async (c) => {
    await c.get('services').attachments.remove(requireActor(c), c.req.param('id'))
    return c.body(null, 204)
  })

  // ── OAuth consent (session only) ────────────────────────────────
  api.post('/oauth/request', async (c) => c.json(await c.get('services').oauth.request(requireActor(c), await json(c), endpointFor(c.get('config'), c.req.url))))
  api.post('/oauth/decision', async (c) => c.json(await c.get('services').oauth.decide(requireActor(c), await json(c), endpointFor(c.get('config'), c.req.url))))

  // ── Agent tokens (session only) ─────────────────────────────────
  api.get('/tokens', async (c) => c.json(await c.get('services').tokens.list(requireActor(c))))
  api.post('/tokens', async (c) => c.json(await c.get('services').tokens.create(requireActor(c), await json(c)), 201))
  api.delete('/tokens/:id', async (c) => {
    await c.get('services').tokens.revoke(requireActor(c), c.req.param('id'))
    return c.body(null, 204)
  })

  // ── Vault (session only, ciphertext only) ───────────────────────
  const vault = new Hono<AppEnv>()
  vault.use('*', sessionOnly)
  vault.get('/', async (c) => c.json(await c.get('services').vault.state(requireActor(c))))
  vault.post('/setup', async (c) => {
    await c.get('services').vault.setup(requireActor(c), await json(c))
    return c.body(null, 204)
  })
  vault.put('/keys', async (c) => {
    await c.get('services').vault.rekey(requireActor(c), await json(c))
    return c.body(null, 204)
  })
  vault.patch('/settings', async (c) => {
    await c.get('services').vault.updateSettings(requireActor(c), await json(c))
    return c.body(null, 204)
  })
  vault.post('/reset', async (c) => {
    const actor = requireActor(c)
    const services = c.get('services')
    const body = (await json(c)) as { accessKey?: unknown }
    const access: Access = services.access
    access.requireUser(actor)
    await services.accounts.verifyAccessKey(actor.userId, String(body?.accessKey ?? ''))
    await services.vault.reset(actor)
    return c.body(null, 204)
  })
  vault.get('/items', async (c) => c.json(await c.get('services').vault.items(requireActor(c))))
  vault.put('/items/:id{[0-9a-f-]{36}}', async (c) =>
    c.json(await c.get('services').vault.putItem(requireActor(c), c.req.param('id'), await json(c))),
  )
  vault.delete('/items/:id{[0-9a-f-]{36}}', async (c) => {
    await c.get('services').vault.deleteItem(requireActor(c), c.req.param('id'))
    return c.body(null, 204)
  })
  api.route('/vault', vault)

  api.all('*', () => {
    throw new AppError(404, 'not_found', 'Unknown API route')
  })
  return api
}
