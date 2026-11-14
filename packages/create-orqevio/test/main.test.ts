import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Io, main } from '../src/main'
import type { Language } from '../src/messages'

const FAKE = path.join(import.meta.dirname, 'fixtures/fake-wrangler.mjs')
const CODE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/
const orqevio = {
  dir: '/opt/orqevio/dist',
  version: '9.9.9',
  base: {
    name: 'orqevio',
    main: 'worker/index.js',
    assets: { directory: 'web', binding: 'ASSETS' },
    r2_buckets: [{ binding: 'UPLOADS', bucket_name: 'orqevio-uploads' }],
    migrations: [{ tag: 'v1' }, { tag: 'v2' }],
    no_bundle: true,
  },
}

let dir: string
let state: string
let log: string
const env = { ...process.env }

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'create-orqevio-test-'))
  state = path.join(dir, 'state.json')
  log = path.join(dir, 'calls.ndjson')
  process.env.CREATE_ORQEVIO_WRANGLER = FAKE
  process.env.FAKE_WRANGLER_STATE = state
  process.env.FAKE_WRANGLER_LOG = log
  delete process.env.WRANGLER_SEND_METRICS
})
afterEach(() => {
  process.env = { ...env }
  rmSync(dir, { recursive: true, force: true })
})

function setState(value: Record<string, unknown>) {
  writeFileSync(state, JSON.stringify({ loggedIn: true, exists: false, ...value }))
}
const calls = (): Array<{ args: string[]; cwd: string; metrics: string | null; account: string | null; secrets?: { content: string; mode: number }; config?: Record<string, any>; stdin?: string }> =>
  existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : []
const commands = () => calls().map((c) => c.args.slice(0, 2).join(' '))

// The assertions below read the Spanish messages; the English ones have tests of their own.
async function run(argv: string[], answers: string[] | null = null, language: Language = 'es', extra: { fetch?: typeof fetch } = {}) {
  const out: string[] = []
  const err: string[] = []
  const io: Io = { out: (t) => out.push(t), err: (t) => err.push(t) }
  if (answers) io.ask = async () => answers.shift() ?? ''
  const code = await main(argv, io, { orqevio, language, fetch: extra.fetch, uninstallWait: { intervalMs: 5, timeoutMs: 60 } })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

/**
 * Stands in for a running copy in a Cloudflare account. It uninstalls only with the token the
 * installer set as its Worker secret in that same account (read back from the fake Wrangler's
 * log), and uninstalling empties the fake Wrangler's bucket, as the real copy empties R2.
 */
function fakeCopy({ name = 'ana', account = 'acc-1' } = {}) {
  const requests: Array<{ origin: string; path: string; body: Record<string, string> | null }> = []
  const respond = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  let uninstalled = false
  const impl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, string>) : null
    requests.push({ origin: url.origin, path: url.pathname, body })
    if (url.pathname === '/api/auth/session') {
      return respond(200, { user: null, workspaces: [], claimed: !uninstalled, recoverable: false, install: 'cli', copyName: name, ...(uninstalled ? { uninstalled: { install: 'cli' } } : {}) })
    }
    if (url.pathname === '/api/uninstall') {
      if (uninstalled) return respond(410, { error: { code: 'uninstalled' } })
      const secret = calls()
        .filter((c) => c.args.join(' ') === `secret put ORQEVIO_UNINSTALL_TOKEN --name ${name}` && c.account === account)
        .at(-1)?.stdin
      if (!secret || body?.token !== secret) return respond(403, { error: { code: 'uninstall_not_authorized' } })
      uninstalled = true
      writeFileSync(state, JSON.stringify({ ...JSON.parse(readFileSync(state, 'utf8')), bucket: 'empty' }))
      return respond(200, { at: '2026-11-14T12:00:00.000Z', install: 'cli', copyName: name, bucket: null })
    }
    return respond(404, {})
  }) as typeof fetch
  return { impl, calls: requests }
}

describe('create-orqevio', () => {
  it('speaks the language asked for, and the terminal’s otherwise', async () => {
    expect((await run(['--help'], null, 'en')).out).toContain('Installs your own copy of Orqevio')
    expect((await run(['--help', '--lang', 'es'], null, 'en')).out).toContain('Instala tu propia copia de Orqevio')
    const unknown = await run(['--lang', 'xx'], null, 'en')
    expect(unknown.code).toBe(2)
    expect(unknown.err).toContain('Unknown language “xx”')
    // Node's own parse errors are said in the user's language too.
    expect((await run(['--nope'])).err).toContain('No conozco la opción «--nope»')
    expect((await run(['--name'], null, 'en')).err).toContain('“--name” needs a value')
    // An explicit --lang applies to the argument errors too, help included.
    const wrong = await run(['--lang', 'es', 'oops'], null, 'en')
    expect(wrong.err).toContain('No conozco la orden «oops»')
    expect(wrong.err).toContain('Instala tu propia copia de Orqevio')
    expect((await run(['--lang=es', '--name'], null, 'en')).err).toContain('«--name» necesita un valor')
    expect(calls()).toHaveLength(0)
  })

  it('shows help and version, and rejects bad input without calling Wrangler', async () => {
    expect((await run(['--help'])).out).toContain('npx create-orqevio@latest update')
    expect((await run(['--version'])).out).toBe('9.9.9')
    expect((await run(['borrar'])).code).toBe(2)
    // A dry run that would really deploy is refused.
    for (const command of [[], ['update'], ['recover'], ['uninstall']]) {
      const dry = await run([...command, '--dry-run', '--name', 'ana'])
      expect(dry.code).toBe(2)
      expect(dry.err).toContain('--dry-run solo vale con deploy-repo')
    }
    const bad = await run(['--name', 'Mi Copia'])
    expect(bad.code).toBe(2)
    expect(bad.err).toContain('«Mi Copia» no vale como nombre')
    expect(calls()).toEqual([])
  })

  it('installs a new copy: signs in, deploys with a one-off secrets file and shows the address and code', async () => {
    setState({ loggedIn: false })
    const result = await run(['--name', 'ana'])
    expect(result.code).toBe(0)
    expect(commands()).toEqual(['whoami --json', 'login', 'whoami --json', 'deployments list', 'r2 bucket', 'deploy --config'])

    const deploy = calls().at(-1)!
    expect(deploy.config).toMatchObject({
      name: 'ana',
      main: path.join(orqevio.dir, 'worker/index.js'),
      assets: { directory: path.join(orqevio.dir, 'web'), binding: 'ASSETS' },
      r2_buckets: [{ binding: 'UPLOADS', bucket_name: 'ana-uploads' }],
      no_bundle: true,
      // Variables set in the Cloudflare dashboard survive deploys.
      keep_vars: true,
      // The app tells the owner how this copy updates.
      vars: { ORQEVIO_INSTALL: 'cli', ORQEVIO_COPY_NAME: 'ana', ORQEVIO_BUCKET: 'ana-uploads' },
    })
    expect(calls().filter((c) => c.args[0] !== 'whoami' && c.args[0] !== 'login').every((c) => c.account === 'acc-1')).toBe(true)
    const code = deploy.secrets!.content.match(/^SETUP_CODE=(.+)\n$/)![1]!
    expect(code).toMatch(CODE)
    if (process.platform !== 'win32') expect(deploy.secrets!.mode).toBe(0o600)
    // Telemetry stays off, and Wrangler runs inside the private folder, which is gone afterwards.
    expect(deploy.metrics).toBe('false')
    expect(path.basename(deploy.cwd)).toMatch(/^create-orqevio-/)
    expect(existsSync(deploy.cwd)).toBe(false)
    expect(calls().every((c) => c.cwd !== process.cwd())).toBe(true)

    expect(result.out).toContain('https://ana.ana.workers.dev')
    expect(result.out).toContain(code)
    expect(result.out).toContain('npx create-orqevio@latest update --name ana')
  })

  it('asks for the name in a terminal and defaults to "orqevio"', async () => {
    setState({})
    const result = await run([], [''])
    expect(result.code).toBe(0)
    expect(calls().at(-1)!.config!.name).toBe('orqevio')
    expect(result.out).toContain('npx create-orqevio@latest update    ')
  })

  it('offers to update a copy that already exists, keeping its setup code', async () => {
    setState({ exists: true })
    const declined = await run(['--name', 'ana'], ['n'])
    expect(declined.code).toBe(1)
    expect(commands()).not.toContain('deploy --config')

    const accepted = await run(['--name', 'ana'], [''])
    expect(accepted.code).toBe(0)
    const deploy = calls().at(-1)!
    expect(deploy.args).not.toContain('--secrets-file')
    expect(accepted.out).toContain('actualizada a Orqevio 9.9.9: https://ana.ana.workers.dev')
  })

  it('never replaces an existing copy without a terminal to confirm it', async () => {
    setState({ exists: true })
    expect((await run(['--name', 'ana'])).code).toBe(1)
    expect(commands()).not.toContain('deploy --config')
  })

  it('stops before deploying a new copy when the account has no R2, and says how to turn it on', async () => {
    setState({ r2Disabled: true })
    const result = await run(['--name', 'ana'])
    expect(result.code).toBe(1)
    expect(result.err).toContain('todavía no tiene R2 activado')
    expect(result.err).toContain('https://dash.cloudflare.com/?to=/:account/r2/overview')
    expect(result.err).toContain('npx create-orqevio --name ana')
    expect(commands()).toEqual(['whoami --json', 'deployments list', 'r2 bucket'])
    expect(calls().at(-1)!.account).toBe('acc-1')

    // Updating an existing copy does not ask: its bucket already exists.
    setState({ r2Disabled: true, exists: true })
    expect((await run(['update', '--name', 'ana'])).code).toBe(0)
    expect(commands().slice(-2)).toEqual(['deployments list', 'deploy --config'])
  })

  it('updates only existing copies', async () => {
    setState({})
    const missing = await run(['update', '--name', 'ana'])
    expect(missing.code).toBe(1)
    expect(missing.err).toContain('No encuentro una copia llamada «ana»')
    expect(commands()).not.toContain('deploy --config')

    setState({ exists: true })
    expect((await run(['update', '--name', 'ana'])).code).toBe(0)
    expect(calls().at(-1)!.args).not.toContain('--secrets-file')
  })

  it('recovers access with a new code sent through stdin, and never creates an empty Worker', async () => {
    setState({})
    expect((await run(['recover', '--name', 'ana'])).code).toBe(1)
    expect(commands()).not.toContain('secret put')

    setState({ exists: true })
    const result = await run(['recover', '--name', 'ana'])
    expect(result.code).toBe(0)
    const put = calls().at(-1)!
    expect(put.args).toEqual(['secret', 'put', 'SETUP_CODE', '--name', 'ana'])
    expect(put.stdin).toMatch(CODE)
    expect(result.out).toContain(put.stdin!)
  })

  it('uninstalls a copy once its name is typed: the bucket first, then the Worker', async () => {
    setState({ exists: true, bucket: 'empty' })
    const result = await run(['uninstall', '--name', 'ana'], ['ana'])
    expect(result.code).toBe(0)
    expect(result.out).toContain('Esto borra para siempre la copia «ana»')
    expect(result.out).toContain('su bucket «ana-uploads»')
    expect(result.out).toContain('La copia «ana» está desinstalada')
    expect(result.out).toContain('npx wrangler logout')
    const deletes = calls().filter((c) => c.args.includes('delete'))
    expect(deletes.map((c) => c.args)).toEqual([
      ['r2', 'bucket', 'delete', 'ana-uploads'],
      ['delete', '--name', 'ana', '--force'],
    ])
    expect(deletes.every((c) => c.account === 'acc-1')).toBe(true)
    expect(JSON.parse(readFileSync(state, 'utf8'))).toMatchObject({ exists: false })
    expect(JSON.parse(readFileSync(state, 'utf8')).bucket).toBeUndefined()
  })

  it('never deletes anything without the name typed, or without a terminal to type it', async () => {
    setState({ exists: true, bucket: 'empty' })
    const wrong = await run(['uninstall', '--name', 'ana'], ['orqevio'])
    expect(wrong.code).toBe(1)
    expect(wrong.err).toContain('No se ha borrado nada')
    expect(calls().some((c) => c.args.includes('delete'))).toBe(false)

    const unattended = await run(['uninstall', '--name', 'ana'])
    expect(unattended.code).toBe(1)
    expect(unattended.err).toContain('ejecuta este comando en una terminal')
    expect(JSON.parse(readFileSync(state, 'utf8'))).toMatchObject({ exists: true, bucket: 'empty' })
  })

  it('keeps the Worker when the bucket still holds attachments, and says how to empty it', async () => {
    setState({ exists: true, bucket: 'full' })
    const result = await run(['uninstall', '--name', 'ana'], ['ana'])
    expect(result.code).toBe(1)
    expect(result.err).toContain('El bucket «ana-uploads» todavía guarda adjuntos')
    expect(result.err).toContain('Ajustes → Desinstalar Orqevio')
    expect(result.err).toContain('R2 → ana-uploads → Settings → Empty Bucket')
    expect(result.err).toContain('npx create-orqevio@latest uninstall --name ana')
    expect(commands()).not.toContain('delete --name')
    expect(JSON.parse(readFileSync(state, 'utf8'))).toMatchObject({ exists: true, bucket: 'full' })
  })

  it('has the copy delete its attachments, authorized from the account, then removes everything in one go', async () => {
    setState({ exists: true, bucket: 'full' })
    const copy = fakeCopy()
    const result = await run(['uninstall', '--name', 'ana'], ['ana', 'ana.ana.workers.dev'], 'es', { fetch: copy.impl })
    expect(result.code).toBe(0)
    expect(result.out).toContain('El instalador puede pedirle a tu copia que los borre')
    expect(result.out).toContain('Autorizando a tu copia desde tu cuenta de Cloudflare')
    expect(result.out).toContain('Tu copia ha borrado sus datos y sus adjuntos')
    expect(result.out).toContain('La copia «ana» está desinstalada')
    // The token goes to the Worker of the chosen account through stdin, and from there to the copy.
    const secret = calls().find((c) => c.args[0] === 'secret')!
    expect(secret.args).toEqual(['secret', 'put', 'ORQEVIO_UNINSTALL_TOKEN', '--name', 'ana'])
    expect(secret.account).toBe('acc-1')
    expect(secret.stdin).toMatch(/^\d{13}\.[\w-]{43}$/)
    expect(Number(secret.stdin!.split('.')[0])).toBeGreaterThan(Date.now())
    expect(copy.calls.map((c) => `${c.origin}${c.path}`)).toEqual(['https://ana.ana.workers.dev/api/auth/session', 'https://ana.ana.workers.dev/api/uninstall'])
    expect(copy.calls[1]!.body).toEqual({ token: secret.stdin })
    // The bucket is tried, emptied through the copy and deleted; then the Worker goes.
    expect(calls().filter((c) => c.args.includes('delete')).map((c) => c.args.join(' '))).toEqual(['r2 bucket delete ana-uploads', 'r2 bucket delete ana-uploads', 'delete --name ana --force'])
    expect(JSON.parse(readFileSync(state, 'utf8')).bucket).toBeUndefined()
    expect(result.out + result.err).not.toContain(secret.stdin)
  })

  it('never erases a copy of another account, even one with the same name, nor anything without an answer', async () => {
    setState({ exists: true, bucket: 'full' })
    // Same name, another Cloudflare account: it never receives the token, so it refuses.
    const elsewhere = fakeCopy({ account: 'acc-2' })
    const result = await run(['uninstall', '--name', 'ana'], ['ana', 'https://ana.otra.workers.dev'], 'es', { fetch: elsewhere.impl })
    expect(result.code).toBe(1)
    expect(result.err).toContain('https://ana.otra.workers.dev no es la copia «ana» de esta cuenta de Cloudflare')
    expect(elsewhere.calls.filter((c) => c.path === '/api/uninstall').length).toBeGreaterThan(0)
    expect(JSON.parse(readFileSync(state, 'utf8'))).toMatchObject({ exists: true, bucket: 'full' })

    const named = fakeCopy({ name: 'otra' })
    const other = await run(['uninstall', '--name', 'ana'], ['ana', 'https://otra.ana.workers.dev', 'http://example.com', ''], 'es', { fetch: named.impl })
    expect(other.err).toContain('https://otra.ana.workers.dev es la copia «otra», no «ana»')
    expect(other.err).toContain('«http://example.com» no es una dirección')
    expect(other.err).toContain('El bucket «ana-uploads» todavía guarda adjuntos')
    expect(named.calls.map((c) => c.path)).toEqual(['/api/auth/session'])

    expect(commands()).not.toContain('delete --name')
    expect(JSON.parse(readFileSync(state, 'utf8'))).toMatchObject({ exists: true, bucket: 'full' })
  })

  it('tells the owner of an older copy to update it first', async () => {
    setState({ exists: true, bucket: 'full' })
    const old = fakeCopy()
    const tooOld = (async (input: string | URL | Request, init?: RequestInit) =>
      new URL(String(input)).pathname === '/api/uninstall' ? new Response('{}', { status: 404 }) : old.impl(input, init)) as typeof fetch
    const result = await run(['uninstall', '--name', 'ana'], ['ana', 'https://ana.ana.workers.dev'], 'es', { fetch: tooOld })
    expect(result.code).toBe(1)
    expect(result.err).toContain('Actualízala con npx create-orqevio@latest update --name ana')
    expect(commands()).not.toContain('delete --name')
  })

  it('finishes an uninstall left halfway, and says when there is nothing to delete', async () => {
    setState({ exists: true })
    expect((await run(['uninstall', '--name', 'ana'], ['ana'])).code).toBe(0)
    expect(calls().filter((c) => c.args.includes('delete')).map((c) => c.args[0])).toEqual(['delete'])

    setState({ exists: false, bucket: 'empty' })
    expect((await run(['uninstall', '--name', 'ana'], ['ana'])).code).toBe(0)
    expect(JSON.parse(readFileSync(state, 'utf8')).bucket).toBeUndefined()

    setState({ exists: false })
    const nothing = await run(['uninstall', '--name', 'ana'], ['ana'])
    expect(nothing.code).toBe(1)
    expect(nothing.err).toContain('No hay ninguna copia llamada «ana» en esta cuenta')
    expect(nothing.out).not.toContain('Esto borra')

    setState({ exists: true, deleteFails: true })
    const failed = await run(['uninstall', '--name', 'ana'], ['ana'])
    expect(failed.code).toBe(1)
    expect(failed.err).toContain('La desinstalación no ha terminado')
  })

  it('reports failures: sign-in, account query and deploy', async () => {
    setState({ loggedIn: false, loginWorks: false })
    expect((await run(['--name', 'ana'])).err).toContain('No se ha completado el inicio de sesión')

    setState({ accountError: true })
    const query = await run(['--name', 'ana'])
    expect(query.err).toContain('No he podido consultar tu cuenta')
    // Wrangler's own diagnostic is shown, not swallowed.
    expect(query.err).toContain('Authentication error [code: 10000]')

    setState({ deployFails: true })
    const failed = await run(['--name', 'ana'])
    expect(failed.code).toBe(1)
    expect(failed.err).toContain('No se ha podido desplegar')
  })

  it('on Windows, opens the sign-in link itself instead of letting Wrangler use PowerShell', async () => {
    setState({ loggedIn: false })
    const opened: string[] = []
    const out: string[] = []
    const io: Io = { out: (t) => out.push(t), err: (t) => out.push(t) }
    const code = await main(['--name', 'ana'], io, { orqevio, language: 'es', platform: 'win32', openOnWindows: (url) => opened.push(url) })
    expect(code).toBe(0)
    expect(calls().find((c) => c.args[0] === 'login')!.args).toEqual(['login', '--browser=false'])
    expect(opened).toEqual(['https://dash.cloudflare.com/oauth2/auth?response_type=code&client_id=abc&state=xyz'])
    expect(out.join('\n')).toContain('abre tú el enlace que aparece abajo')
  })

  it('elsewhere, lets Wrangler open the browser, and explains how to sign in by hand if it fails', async () => {
    setState({ loggedIn: false, loginWorks: false })
    const opened: string[] = []
    const out: string[] = []
    const io: Io = { out: (t) => out.push(t), err: (t) => out.push(t) }
    expect(await main(['--name', 'ana'], io, { orqevio, language: 'es', platform: 'darwin', openOnWindows: (url) => opened.push(url) })).toBe(1)
    expect(calls().find((c) => c.args[0] === 'login')!.args).toEqual(['login'])
    expect(opened).toEqual([])
    expect(out.join('\n')).toContain('inicia sesión aparte con npx wrangler login --browser=false')
  })

  it('asks which account to use when the login has several, and uses it for every call', async () => {
    const accounts = [
      { id: 'acc-1', name: 'Personal' },
      { id: 'acc-2', name: 'Empresa' },
    ]
    setState({ accounts })
    const result = await run(['--name', 'ana'], ['2'])
    expect(result.code).toBe(0)
    expect(result.out).toContain('2. Empresa')
    const accountCalls = calls().filter((c) => c.args[0] !== 'whoami')
    expect(accountCalls.length).toBeGreaterThan(1)
    expect(accountCalls.every((c) => c.account === 'acc-2')).toBe(true)

    // Without a terminal, it lists them instead of guessing.
    setState({ accounts })
    const blind = await run(['--name', 'ana'])
    expect(blind.code).toBe(1)
    expect(blind.err).toContain('Empresa: acc-2')

    // --account (by id or name) or CLOUDFLARE_ACCOUNT_ID choose it up front.
    setState({ accounts })
    expect((await run(['--name', 'ana', '--account', 'Empresa'])).code).toBe(0)
    expect(calls().at(-1)!.account).toBe('acc-2')
    setState({ accounts })
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acc-1'
    expect((await run(['--name', 'ana'])).code).toBe(0)
    expect(calls().at(-1)!.account).toBe('acc-1')
    setState({ accounts })
    const unknown = await run(['--name', 'ana', '--account', 'otra'])
    expect(unknown.code).toBe(1)
    expect(unknown.err).toContain('no tiene acceso a la cuenta «otra»')
  })

  it('deploys a repository made with the button: names from the repository, everything else from the package', async () => {
    setState({})
    const repo = path.join(dir, 'repo')
    mkdirSync(repo)
    writeFileSync(
      path.join(repo, 'wrangler.jsonc'),
      `// chosen when the repository was created
      { "name": "mi-copia", "r2_buckets": [{ "binding": "UPLOADS", "bucket_name": "mis-adjuntos" }], "migrations": [{ "tag": "v1" }], }`,
    )
    const cwd = process.cwd()
    process.chdir(repo)
    try {
      expect((await run(['deploy-repo'])).code).toBe(0)
      expect((await run(['deploy-repo', '--dry-run'])).code).toBe(0)
    } finally {
      process.chdir(cwd)
    }
    // Workers Builds provides the credentials: no sign-in or account questions.
    expect(commands()).toEqual(['deploy --config', 'deploy --config'])
    const [deploy, dry] = calls()
    expect(deploy!.config).toMatchObject({
      name: 'mi-copia',
      r2_buckets: [{ binding: 'UPLOADS', bucket_name: 'mis-adjuntos' }],
      migrations: [{ tag: 'v1' }, { tag: 'v2' }],
      keep_vars: true,
      vars: { ORQEVIO_INSTALL: 'button', ORQEVIO_COPY_NAME: 'mi-copia', ORQEVIO_BUCKET: 'mis-adjuntos' },
    })
    expect(deploy!.args).not.toContain('--secrets-file')
    expect(dry!.args).toContain('--dry-run')

    writeFileSync(path.join(repo, 'wrangler.jsonc'), '{ "name": "Mi Copia" }')
    process.chdir(repo)
    try {
      expect((await run(['deploy-repo'])).err).toContain('«Mi Copia»')
    } finally {
      process.chdir(cwd)
    }
  })

  it('respects telemetry the user turned on', async () => {
    setState({})
    process.env.WRANGLER_SEND_METRICS = 'true'
    await run(['--name', 'ana'])
    expect(calls().every((c) => c.metrics === 'true')).toBe(true)
  })
})
