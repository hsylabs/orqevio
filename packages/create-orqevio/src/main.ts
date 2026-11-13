import { rmSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { DEFAULT_NAME, type BaseConfig, copyConfig, isValidName, loadOrqevio } from './config'
import { parseJsonc } from './jsonc'
import { CATALOGS, LANGUAGES, type Language, type Messages, detectLanguage, isLanguage } from './messages'
import { generateSetupCode } from './setup-code'
import { deployedUrls, runWrangler } from './wrangler'

export interface Io {
  out(text: string): void
  err(text: string): void
  /** Asks a question; missing when there is no terminal to answer it. */
  ask?: (question: string) => Promise<string>
}

type Command = 'install' | 'update' | 'recover' | 'config' | 'deploy-repo'


const MIN_NODE = [22, 12] as const

export interface Deps {
  /** The `orqevio` package to deploy (tests pass their own). */
  orqevio?: ReturnType<typeof loadOrqevio>
  /** The language of the messages; by default the terminal's (see detectLanguage). */
  language?: Language
}

const R2_DASHBOARD = 'https://dash.cloudflare.com/?to=/:account/r2/overview'

export async function main(argv: string[], io: Io = terminalIo(), deps: Deps = {}): Promise<number> {
  let m = CATALOGS[deps.language ?? detectLanguage()]
  let parsed: ReturnType<typeof parse>
  try {
    parsed = parse(argv, m)
  } catch (error) {
    io.err(`${(error as Error).message}\n\n${m.help(DEFAULT_NAME)}`)
    return 2
  }
  const { command, name: givenName, account: givenAccount, help, version, dryRun, lang } = parsed
  if (lang !== undefined) {
    if (!isLanguage(lang)) {
      io.err(m.unknownLanguage(lang, LANGUAGES.join(', ')))
      return 2
    }
    m = CATALOGS[lang]
  }
  if (help) {
    io.out(m.help(DEFAULT_NAME))
    return 0
  }
  const orqevio = deps.orqevio ?? loadOrqevio()
  if (version) {
    io.out(orqevio.version)
    return 0
  }
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number)
  if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
    io.err(m.needsNode(MIN_NODE.join('.'), process.versions.node))
    return 1
  }

  if (command === 'deploy-repo') return deployRepo(orqevio, dryRun, io, m)

  let name = givenName ?? DEFAULT_NAME
  if (givenName === undefined && io.ask && command !== 'config') {
    name = (await io.ask(m.askName(DEFAULT_NAME))).trim() || DEFAULT_NAME
  }
  if (!isValidName(name)) {
    io.err(`${m.badName(name)} ${m.nameRule}`)
    return 2
  }

  if (command === 'config') {
    io.out(JSON.stringify(copyConfig(orqevio.base, orqevio.dir, name), null, 2))
    return 0
  }

  io.out(`\n${m.heading(command, orqevio.version, name)}\n`)
  const accounts = await signIn(io, m)
  if (!accounts) return 1
  const account = await chooseAccount(accounts, givenAccount ?? process.env.CLOUDFLARE_ACCOUNT_ID, io, m)
  if (!account) return 1
  // Every later call uses this account, so Wrangler never has to ask (it cannot while its output is captured).
  const env = { CLOUDFLARE_ACCOUNT_ID: account }

  const exists = await workerExists(name, env, io)
  if (exists === null) {
    io.err(m.accountUnreachable)
    return 1
  }
  let mode = command
  if (command === 'install' && exists) {
    const answer = io.ask ? (await io.ask(`${m.askUpdate(name)} ${m.yesNo} `)).trim() : 'n'
    if (m.no.test(answer)) {
      io.err(m.nothingChanged)
      return 1
    }
    mode = 'update'
  }
  if ((mode === 'update' || mode === 'recover') && !exists) {
    io.err(m.copyNotFound(name, `npx create-orqevio${nameFlag(name)}`))
    return 1
  }
  if (mode === 'install' && !(await r2Enabled(env))) {
    io.err(m.r2Disabled(R2_DASHBOARD, `npx create-orqevio${nameFlag(name)}`))
    return 1
  }
  return mode === 'recover' ? recover(name, env, io, m) : deploy(mode === 'update' ? 'update' : 'install', name, orqevio, env, io, m)
}

const parseOptions = (argv: string[]) =>
  parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      account: { type: 'string' },
      lang: { type: 'string' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })

/** Node's own messages for bad options are in English: say them in the user's language. */
function parseError(error: unknown, m: Messages) {
  const code = (error as { code?: string }).code
  const option = /'(--?[\w-]+)/.exec((error as Error).message)?.[1] ?? ''
  if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') return new Error(m.unknownOption(option))
  if (code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') return new Error(m.missingValue(option))
  return error
}

function parse(argv: string[], m: Messages) {
  let args: ReturnType<typeof parseOptions>
  try {
    args = parseOptions(argv)
  } catch (error) {
    throw parseError(error, m)
  }
  const { values, positionals } = args
  if (positionals.length > 1) throw new Error(m.extraArgument(positionals[1]!))
  const command = (positionals[0] ?? 'install') as Command
  if (!['install', 'update', 'recover', 'config', 'deploy-repo'].includes(command)) throw new Error(m.unknownCommand(command))
  // Only deploy-repo can deploy without changing anything; anywhere else the flag would be ignored.
  if (values['dry-run'] && command !== 'deploy-repo') throw new Error(m.dryRunOnlyForDeployRepo)
  return {
    command,
    name: values.name,
    account: values.account,
    lang: values.lang?.trim().toLowerCase(),
    help: values.help ?? false,
    version: values.version ?? false,
    dryRun: values['dry-run'] ?? false,
  }
}

const nameFlag = (name: string) => (name === DEFAULT_NAME ? '' : ` --name ${name}`)

interface Account {
  id: string
  name: string
}

/** Signs in with Wrangler's own login when needed; returns the accounts this login can use. */
async function signIn(io: Io, m: Messages): Promise<Account[] | null> {
  let accounts = await whoami()
  if (!accounts) {
    io.out(m.signInPrompt)
    if ((await runWrangler(['login'])).code === 0) accounts = await whoami()
  }
  if (!accounts) io.err(m.signInFailed)
  return accounts
}

async function whoami(): Promise<Account[] | null> {
  const { stdout } = await runWrangler(['whoami', '--json'], { capture: true })
  try {
    const info = JSON.parse(stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1)) as { loggedIn?: boolean; accounts?: Account[] }
    return info.loggedIn === true ? (info.accounts ?? []) : null
  } catch {
    return null
  }
}

async function chooseAccount(accounts: Account[], wanted: string | undefined, io: Io, m: Messages): Promise<string | null> {
  if (wanted) {
    const match = accounts.find((a) => a.id === wanted || a.name === wanted)
    // An API token may not list its account: trust an explicit ID.
    if (match || !accounts.length) return match?.id ?? wanted
    io.err(m.noAccessToAccount(wanted, accountList(accounts)))
    return null
  }
  if (accounts.length === 1) return accounts[0]!.id
  if (!accounts.length) {
    io.err(m.noAccounts)
    return null
  }
  if (!io.ask) {
    io.err(m.chooseAccountWithFlag(accountList(accounts)))
    return null
  }
  io.out(m.severalAccounts(accounts.map((a, i) => `  ${i + 1}. ${a.name}`).join('\n')))
  for (;;) {
    const answer = (await io.ask(m.whichAccount(accounts.length))).trim()
    const index = Number(answer) - 1
    if (Number.isInteger(index) && accounts[index]) return accounts[index]!.id
    if (!answer) return null
  }
}

const accountList = (accounts: Account[]) => accounts.map((a) => `  ${a.name}: ${a.id}`).join('\n')

/** true or false, or null when the account could not be queried. */
async function workerExists(name: string, env: Record<string, string>, io?: Io): Promise<boolean | null> {
  const run = await runWrangler(['deployments', 'list', '--name', name, '--json'], { capture: true, env })
  if (run.code === 0) return true
  // Cloudflare's API answers 10007 for a Worker that does not exist.
  if (/\b10007\b/.test(run.stdout + run.stderr)) return false
  io?.err((run.stderr || run.stdout).trim())
  return null
}

/**
 * A new copy needs R2 for its attachments, and an account must subscribe to R2 in the
 * dashboard before it can create a bucket. Cloudflare answers 10042 (NotEntitled) until
 * then. Any other answer lets the deploy go ahead and report its own errors.
 */
async function r2Enabled(env: Record<string, string>) {
  const run = await runWrangler(['r2', 'bucket', 'list'], { capture: true, env })
  return !(run.code !== 0 && /\b10042\b/.test(run.stdout + run.stderr))
}

/** A private temporary folder for the generated configuration and the secrets file, removed even on Ctrl+C. */
async function withWorkspace<T>(work: (dir: string) => Promise<T>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'create-orqevio-'))
  const cleanup = () => rmSync(dir, { recursive: true, force: true })
  const interrupted = () => {
    cleanup()
    process.exit(130)
  }
  process.once('SIGINT', interrupted)
  try {
    return await work(dir)
  } finally {
    process.off('SIGINT', interrupted)
    cleanup()
  }
}

async function deploy(mode: 'install' | 'update', name: string, orqevio: ReturnType<typeof loadOrqevio>, env: Record<string, string>, io: Io, m: Messages) {
  return withWorkspace(async (dir) => {
    const configFile = path.join(dir, 'wrangler.json')
    await writeFile(configFile, JSON.stringify(copyConfig(orqevio.base, orqevio.dir, name), null, 2))
    const args = ['deploy', '--config', configFile]
    let setupCode: string | null = null
    if (mode === 'install') {
      setupCode = generateSetupCode()
      const secretsFile = path.join(dir, 'secrets.env')
      await writeFile(secretsFile, `SETUP_CODE=${setupCode}\n`, { mode: 0o600 })
      args.push('--secrets-file', secretsFile)
    }
    const outputFile = path.join(dir, 'output.ndjson')
    const run = await runWrangler(args, { cwd: dir, env: { ...env, WRANGLER_OUTPUT_FILE_PATH: outputFile } })
    if (run.code !== 0) {
      io.err(m.deployFailed)
      return 1
    }
    const url = deployedUrls(outputFile).find((target) => target.startsWith('https://'))
    const where = url ?? m.workerAddress(name)
    if (mode === 'update') {
      io.out(m.updated(orqevio.version, where))
      return 0
    }
    io.out(
      m.installed({
        address: where,
        setupCode: setupCode!,
        updateCommand: `npx create-orqevio@latest update${nameFlag(name)}`,
        recoverCommand: `npx create-orqevio@latest recover${nameFlag(name)}`,
      }),
    )
    return 0
  })
}

/**
 * `deploy-repo`: the deploy command of a repository created with the "Deploy to
 * Cloudflare" button (templates/cloudflare), run by Workers Builds on every push.
 * The repository's wrangler.jsonc only provides the names chosen when it was
 * created; everything else (bindings, migrations, compatibility settings) comes
 * from the installed package, so updating the dependency is enough to pick up a
 * new migration. The setup code is a secret set when the repository was created.
 */
async function deployRepo(orqevio: ReturnType<typeof loadOrqevio>, dryRun: boolean, io: Io, m: Messages) {
  let repo: Partial<BaseConfig>
  try {
    repo = parseJsonc(readFileSync('wrangler.jsonc', 'utf8')) as Partial<BaseConfig>
  } catch (error) {
    io.err(m.cannotReadRepoConfig((error as Error).message))
    return 1
  }
  const name = typeof repo.name === 'string' ? repo.name : ''
  if (!isValidName(name)) {
    io.err(`${m.badRepoName(name)} ${m.nameRule}`)
    return 1
  }
  const config = copyConfig(orqevio.base, orqevio.dir, name, 'button')
  const bucket = repo.r2_buckets?.find((b) => b.binding === 'UPLOADS')?.bucket_name
  if (bucket) config.r2_buckets = config.r2_buckets.map((b) => (b.binding === 'UPLOADS' ? { ...b, bucket_name: bucket } : b))
  return withWorkspace(async (dir) => {
    const configFile = path.join(dir, 'wrangler.json')
    await writeFile(configFile, JSON.stringify(config, null, 2))
    const args = ['deploy', '--config', configFile, ...(dryRun ? ['--dry-run', '--outdir', path.join(dir, 'out')] : [])]
    io.out(`Orqevio ${orqevio.version} → Worker ${name}`)
    const run = await runWrangler(args, { cwd: dir })
    return run.code === 0 ? 0 : 1
  })
}

async function recover(name: string, env: Record<string, string>, io: Io, m: Messages) {
  const setupCode = generateSetupCode()
  // The code goes through stdin, never on the command line.
  const run = await runWrangler(['secret', 'put', 'SETUP_CODE', '--name', name], { input: setupCode, env })
  if (run.code !== 0) {
    io.err(m.setupCodeFailed)
    return 1
  }
  io.out(m.recovered(setupCode))
  return 0
}

function terminalIo(): Io {
  return {
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
    ask: process.stdin.isTTY
      ? async (question) => {
          const rl = createInterface({ input: process.stdin, output: process.stdout })
          try {
            return await rl.question(question)
          } finally {
            rl.close()
          }
        }
      : undefined,
  }
}
