import { rmSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { DEFAULT_NAME, copyConfig, loadOrqevio, nameProblem } from './config'
import { generateSetupCode } from './setup-code'
import { deployedUrls, runWrangler } from './wrangler'

export interface Io {
  out(text: string): void
  err(text: string): void
  /** Asks a question; missing when there is no terminal to answer it. */
  ask?: (question: string) => Promise<string>
}

type Command = 'install' | 'update' | 'recover' | 'config'

const HELP = `Instala tu propia copia de Orqevio en tu cuenta de Cloudflare.

Uso:
  npx create-orqevio                   Instala una copia nueva
  npx create-orqevio@latest update     Actualiza tu copia a la última versión (tus datos se conservan)
  npx create-orqevio@latest recover    Genera un código nuevo para recuperar el acceso

Opciones:
  --name <nombre>   Nombre de la copia (por defecto, ${DEFAULT_NAME}). Forma parte de su dirección.
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
  const { command, name: givenName, help, version } = parsed
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
  if (!(await ensureSignedIn(io))) return 1

  const exists = await workerExists(name)
  if (exists === null) {
    io.err('No he podido consultar tu cuenta de Cloudflare. Revisa el mensaje de arriba y vuelve a intentarlo.')
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
  return mode === 'recover' ? recover(name, io) : deploy(mode === 'update' ? 'update' : 'install', name, orqevio, io)
}

const TITLES: Record<Exclude<Command, 'config'>, string> = {
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
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })
  if (positionals.length > 1) throw new Error(`Sobra «${positionals[1]}».`)
  const command = (positionals[0] ?? 'install') as Command
  if (!['install', 'update', 'recover', 'config'].includes(command)) throw new Error(`No conozco la orden «${command}».`)
  return { command, name: values.name, help: values.help ?? false, version: values.version ?? false }
}

const nameFlag = (name: string) => (name === DEFAULT_NAME ? '' : ` --name ${name}`)

async function ensureSignedIn(io: Io) {
  const who = await runWrangler(['whoami', '--json'], { capture: true })
  if (isSignedIn(who.stdout)) return true
  io.out('Inicia sesión en Cloudflare en el navegador que se va a abrir…\n')
  const login = await runWrangler(['login'])
  if (login.code === 0 && isSignedIn((await runWrangler(['whoami', '--json'], { capture: true })).stdout)) return true
  io.err('No se ha completado el inicio de sesión en Cloudflare.')
  return false
}

function isSignedIn(stdout: string) {
  const json = stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1)
  try {
    return (JSON.parse(json) as { loggedIn?: boolean }).loggedIn === true
  } catch {
    return false
  }
}

/** true or false, or null when the account could not be queried. */
async function workerExists(name: string): Promise<boolean | null> {
  const run = await runWrangler(['deployments', 'list', '--name', name, '--json'], { capture: true })
  if (run.code === 0) return true
  // Cloudflare's API answers 10007 for a Worker that does not exist.
  return /\b10007\b/.test(run.stdout + run.stderr) ? false : null
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

async function deploy(mode: 'install' | 'update', name: string, orqevio: ReturnType<typeof loadOrqevio>, io: Io) {
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
    const run = await runWrangler(args, { cwd: dir, env: { WRANGLER_OUTPUT_FILE_PATH: outputFile } })
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

async function recover(name: string, io: Io) {
  const setupCode = generateSetupCode()
  // The code goes through stdin, never on the command line.
  const run = await runWrangler(['secret', 'put', 'SETUP_CODE', '--name', name], { input: setupCode })
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
