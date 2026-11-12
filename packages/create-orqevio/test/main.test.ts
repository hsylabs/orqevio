import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Io, main } from '../src/main'

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
const calls = (): Array<{ args: string[]; cwd: string; metrics: string | null; secrets?: { content: string; mode: number }; config?: Record<string, any>; stdin?: string }> =>
  existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : []
const commands = () => calls().map((c) => c.args.slice(0, 2).join(' '))

async function run(argv: string[], answers: string[] | null = null) {
  const out: string[] = []
  const err: string[] = []
  const io: Io = { out: (t) => out.push(t), err: (t) => err.push(t) }
  if (answers) io.ask = async () => answers.shift() ?? ''
  const code = await main(argv, io, { orqevio })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

describe('create-orqevio', () => {
  it('shows help and version, and rejects bad input without calling Wrangler', async () => {
    expect((await run(['--help'])).out).toContain('npx create-orqevio@latest update')
    expect((await run(['--version'])).out).toBe('9.9.9')
    expect((await run(['borrar'])).code).toBe(2)
    const bad = await run(['--name', 'Mi Copia'])
    expect(bad.code).toBe(2)
    expect(bad.err).toContain('«Mi Copia» no vale como nombre')
    expect(calls()).toEqual([])
  })

  it('installs a new copy: signs in, deploys with a one-off secrets file and shows the address and code', async () => {
    setState({ loggedIn: false })
    const result = await run(['--name', 'ana'])
    expect(result.code).toBe(0)
    expect(commands()).toEqual(['whoami --json', 'login', 'whoami --json', 'deployments list', 'deploy --config'])

    const deploy = calls().at(-1)!
    expect(deploy.config).toMatchObject({
      name: 'ana',
      main: path.join(orqevio.dir, 'worker/index.js'),
      assets: { directory: path.join(orqevio.dir, 'web'), binding: 'ASSETS' },
      r2_buckets: [{ binding: 'UPLOADS', bucket_name: 'ana-uploads' }],
      no_bundle: true,
    })
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

  it('reports failures: sign-in, account query and deploy', async () => {
    setState({ loggedIn: false, loginWorks: false })
    expect((await run(['--name', 'ana'])).err).toContain('No se ha completado el inicio de sesión')

    setState({ accountError: true })
    expect((await run(['--name', 'ana'])).err).toContain('No he podido consultar tu cuenta')

    setState({ deployFails: true })
    const failed = await run(['--name', 'ana'])
    expect(failed.code).toBe(1)
    expect(failed.err).toContain('No se ha podido desplegar')
  })

  it('respects telemetry the user turned on', async () => {
    setState({})
    process.env.WRANGLER_SEND_METRICS = 'true'
    await run(['--name', 'ana'])
    expect(calls().every((c) => c.metrics === 'true')).toBe(true)
  })
})
