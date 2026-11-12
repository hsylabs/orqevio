import { rmSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { DEFAULT_NAME, type BaseConfig, copyConfig, loadOrqevio, nameProblem } from './config'
import { parseJsonc } from './jsonc'
import { generateSetupCode } from './setup-code'
import { deployedUrls, runWrangler } from './wrangler'

export interface Io {
  out(text: string): void
  err(text: string): void
  /** Asks a question; missing when there is no terminal to answer it. */
  ask?: (question: string) => Promise<string>
}

type Command = 'install' | 'update' | 'recover' | 'config' | 'deploy-repo'

const HELP = `Instala tu propia copia de Orqevio en tu cuenta de Cloudflare.

Uso:
  npx create-orqevio                   Instala una copia nueva
  npx create-orqevio@latest update     Actualiza tu copia a la última versión (tus datos se conservan)
  npx create-orqevio@latest recover    Genera un código nuevo para recuperar el acceso

Opciones:
  --name <nombre>   Nombre de la copia (por defecto, ${DEFAULT_NAME}). Forma parte de su dirección.
  --account <id>    Cuenta de Cloudflare que usar, si tienes varias (o CLOUDFLARE_ACCOUNT_ID)
  -h, --help        Muestra esta ayuda
  -v, --version     Muestra la versión de Orqevio que se instala

Necesitas una cuenta de Cloudflare (el plan gratuito basta). La primera vez se abrirá el
navegador para que inicies sesión.`

const MIN_NODE = [22, 12] as const

export interface Deps {
  /** The `orqevio` package to deploy (tests pass their own). */
  orqevio?: ReturnType<typeof loadOrqevio>
}

export async function main(argv: string[], io: Io = terminalIo(), deps: Deps = {}): Promise<number> {
  let parsed: ReturnType<typeof parse>
  try {
    parsed = parse(argv)
  } catch (error) {
    io.err(`${(error as Error).message}\n\n${HELP}`)
    return 2
  }
  const { command, name: givenName, account: givenAccount, help, version, dryRun } = parsed
  if (help) {
    io.out(HELP)
    return 0
  }
  const orqevio = deps.orqevio ?? loadOrqevio()
  if (version) {
    io.out(orqevio.version)
    return 0
  }
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number)
  if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
    io.err(`Necesitas Node ${MIN_NODE.join('.')} o superior (tienes ${process.versions.node}). Descárgalo en https://nodejs.org.`)
    return 1
  }

  if (command === 'deploy-repo') return deployRepo(orqevio, dryRun, io)

  let name = givenName ?? DEFAULT_NAME
  if (givenName === undefined && io.ask && command !== 'config') {
    name = (await io.ask(`Nombre de la copia (${DEFAULT_NAME}): `)).trim() || DEFAULT_NAME
  }
  const problem = nameProblem(name)
  if (problem) {
    io.err(`«${name}» no vale como nombre. ${problem}`)
    return 2
  }

  if (command === 'config') {
    io.out(JSON.stringify(copyConfig(orqevio.base, orqevio.dir, name), null, 2))
    return 0
  }

  io.out(`\nOrqevio ${orqevio.version} · ${TITLES[command]} «${name}»\n`)
  const accounts = await signIn(io)
  if (!accounts) return 1
  const account = await chooseAccount(accounts, givenAccount ?? process.env.CLOUDFLARE_ACCOUNT_ID, io)
  if (!account) return 1
  // Every later call uses this account, so Wrangler never has to ask (it cannot while its output is captured).
  const env = { CLOUDFLARE_ACCOUNT_ID: account }

  const exists = await workerExists(name, env, io)
  if (exists === null) {
    io.err('No he podido consultar tu cuenta de Cloudflare. Vuelve a intentarlo en unos minutos.')
    return 1
  }
  let mode = command
  if (command === 'install' && exists) {
    const answer = io.ask ? (await io.ask(`Ya tienes una copia llamada «${name}». ¿La actualizo a esta versión? Tus datos se conservan. [S/n] `)).trim() : 'n'
    if (/^n/i.test(answer)) {
      io.err(`No he cambiado nada. Para otra copia, usa otro nombre: npx create-orqevio --name <nombre>`)
      return 1
    }
    mode = 'update'
  }
  if ((mode === 'update' || mode === 'recover') && !exists) {
    io.err(`No encuentro una copia llamada «${name}» en esta cuenta. Para instalarla: npx create-orqevio${nameFlag(name)}`)
    return 1
  }
  return mode === 'recover' ? recover(name, env, io) : deploy(mode === 'update' ? 'update' : 'install', name, orqevio, env, io)
}

const TITLES: Record<Exclude<Command, 'config' | 'deploy-repo'>, string> = {
  install: 'instalar la copia',
  update: 'actualizar la copia',
  recover: 'recuperar el acceso a la copia',
}

function parse(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      account: { type: 'string' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })
  if (positionals.length > 1) throw new Error(`Sobra «${positionals[1]}».`)
  const command = (positionals[0] ?? 'install') as Command
  if (!['install', 'update', 'recover', 'config', 'deploy-repo'].includes(command)) throw new Error(`No conozco la orden «${command}».`)
  // Only deploy-repo can deploy without changing anything; anywhere else the flag would be ignored.
  if (values['dry-run'] && command !== 'deploy-repo') throw new Error('--dry-run solo vale con deploy-repo.')
  return {
    command,
    name: values.name,
    account: values.account,
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
async function signIn(io: Io): Promise<Account[] | null> {
  let accounts = await whoami()
  if (!accounts) {
    io.out('Inicia sesión en Cloudflare en el navegador que se va a abrir…\n')
    if ((await runWrangler(['login'])).code === 0) accounts = await whoami()
  }
  if (!accounts) io.err('No se ha completado el inicio de sesión en Cloudflare.')
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

async function chooseAccount(accounts: Account[], wanted: string | undefined, io: Io): Promise<string | null> {
  if (wanted) {
    const match = accounts.find((a) => a.id === wanted || a.name === wanted)
    // An API token may not list its account: trust an explicit ID.
    if (match || !accounts.length) return match?.id ?? wanted
    io.err(`Esta sesión no tiene acceso a la cuenta «${wanted}». Cuentas disponibles:\n${accountList(accounts)}`)
    return null
  }
  if (accounts.length === 1) return accounts[0]!.id
  if (!accounts.length) {
    io.err('Tu sesión de Cloudflare no tiene ninguna cuenta disponible.')
    return null
  }
  if (!io.ask) {
    io.err(`Tienes varias cuentas de Cloudflare. Elige una con --account <id>:\n${accountList(accounts)}`)
    return null
  }
  io.out(`Tienes varias cuentas de Cloudflare:\n${accounts.map((a, i) => `  ${i + 1}. ${a.name}`).join('\n')}`)
  for (;;) {
    const answer = (await io.ask(`¿Cuál uso? (1-${accounts.length}): `)).trim()
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

async function deploy(mode: 'install' | 'update', name: string, orqevio: ReturnType<typeof loadOrqevio>, env: Record<string, string>, io: Io) {
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
      io.err('\nNo se ha podido desplegar. Revisa el mensaje de Wrangler de arriba; puedes repetir la orden sin perder nada.')
      return 1
    }
    const url = deployedUrls(outputFile).find((target) => target.startsWith('https://'))
    const where = url ?? `la dirección de tu Worker «${name}» (panel de Cloudflare → Workers y Pages)`
    if (mode === 'update') {
      io.out(`\nTu copia está actualizada a Orqevio ${orqevio.version}: ${where}`)
      return 0
    }
    io.out(
      [
        '',
        'Tu copia de Orqevio está en marcha.',
        '',
        `  Dirección                ${where}`,
        `  Código de configuración  ${setupCode}`,
        '',
        'Ábrela, escribe el código y tu nombre. Orqevio te dará entonces tu clave de acceso:',
        'guárdala en tu gestor de contraseñas, porque es lo único que necesitas para entrar.',
        'El código deja de servir en cuanto reclames la copia.',
        '',
        'Más adelante:',
        `  npx create-orqevio@latest update${nameFlag(name)}    actualiza tu copia (tus datos se conservan)`,
        `  npx create-orqevio@latest recover${nameFlag(name)}   te da un código nuevo si pierdes la clave`,
      ].join('\n'),
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
async function deployRepo(orqevio: ReturnType<typeof loadOrqevio>, dryRun: boolean, io: Io) {
  let repo: Partial<BaseConfig>
  try {
    repo = parseJsonc(readFileSync('wrangler.jsonc', 'utf8')) as Partial<BaseConfig>
  } catch (error) {
    io.err(`No puedo leer wrangler.jsonc en esta carpeta: ${(error as Error).message}`)
    return 1
  }
  const name = typeof repo.name === 'string' ? repo.name : ''
  const problem = nameProblem(name)
  if (problem) {
    io.err(`El nombre del Worker en wrangler.jsonc («${name}») no vale. ${problem}`)
    return 1
  }
  const config = copyConfig(orqevio.base, orqevio.dir, name, 'button')
  const bucket = repo.r2_buckets?.find((b) => b.binding === 'UPLOADS')?.bucket_name
  if (bucket) config.r2_buckets = config.r2_buckets.map((b) => (b.binding === 'UPLOADS' ? { ...b, bucket_name: bucket } : b))
  return withWorkspace(async (dir) => {
    const configFile = path.join(dir, 'wrangler.json')
    await writeFile(configFile, JSON.stringify(config, null, 2))
    const args = ['deploy', '--config', configFile, ...(dryRun ? ['--dry-run', '--outdir', path.join(dir, 'out')] : [])]
    io.out(`Orqevio ${orqevio.version} → Worker «${name}»`)
    const run = await runWrangler(args, { cwd: dir })
    return run.code === 0 ? 0 : 1
  })
}

async function recover(name: string, env: Record<string, string>, io: Io) {
  const setupCode = generateSetupCode()
  // The code goes through stdin, never on the command line.
  const run = await runWrangler(['secret', 'put', 'SETUP_CODE', '--name', name], { input: setupCode, env })
  if (run.code !== 0) {
    io.err('\nNo se ha podido cambiar el código. Revisa el mensaje de Wrangler de arriba.')
    return 1
  }
  io.out(
    [
      '',
      `Nuevo código de configuración: ${setupCode}`,
      '',
      'Abre tu copia, pulsa «¿Has perdido la clave?» y escribe este código para recibir una',
      'clave de acceso nueva. Se cerrarán todas las sesiones; tus datos y tu bóveda no cambian.',
    ].join('\n'),
  )
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
