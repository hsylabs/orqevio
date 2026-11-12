// Assembles the deployable Orqevio for Cloudflare in dist/:
//   worker/index.js  the Worker bundle, built by Wrangler exactly as `wrangler deploy` would
//   web/             the web app (built beforehand by @orqevio/web)
//   wrangler.json    apps/server/wrangler.jsonc with paths relative to dist/
// apps/server/wrangler.jsonc stays the single source of bindings and migrations.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(packageDir, '../..')
const server = path.join(root, 'apps/server')
const webDist = path.join(root, 'apps/web/dist')
const out = path.join(packageDir, 'dist')

if (!existsSync(path.join(webDist, 'index.html'))) {
  console.error('apps/web/dist is missing: run `pnpm --filter @orqevio/web build` first.')
  process.exit(1)
}

/** JSON with // and /* comments and trailing commas, as Wrangler accepts. */
function parseJsonc(text) {
  let json = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      const end = stringEnd(text, i)
      json += text.slice(i, end + 1)
      i = end
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      json += '\n'
    } else if (ch === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1
    } else json += ch
  }
  return JSON.parse(json.replace(/,(\s*[}\]])/g, '$1'))
}

function stringEnd(text, start) {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++
    else if (text[i] === '"') return i
  }
  throw new Error('Unterminated string in wrangler.jsonc')
}

rmSync(out, { recursive: true, force: true })
const bundleDir = mkdtempSync(path.join(tmpdir(), 'orqevio-worker-'))
try {
  const require = createRequire(path.join(server, 'package.json'))
  const wranglerPkg = require.resolve('wrangler/package.json')
  const wrangler = path.join(path.dirname(wranglerPkg), JSON.parse(readFileSync(wranglerPkg, 'utf8')).bin.wrangler)
  execFileSync(process.execPath, [wrangler, 'deploy', '--dry-run', '--outdir', bundleDir], {
    cwd: server,
    stdio: 'inherit',
    env: { WRANGLER_SEND_METRICS: 'false', ...process.env },
  })
  const modules = readdirSync(bundleDir).filter((file) => !file.endsWith('.map') && file !== 'README.md')
  if (modules.length !== 1 || modules[0] !== 'index.js') throw new Error(`Expected a single-module Worker bundle, got: ${modules.join(', ')}`)
  mkdirSync(path.join(out, 'worker'), { recursive: true })
  cpSync(path.join(bundleDir, 'index.js'), path.join(out, 'worker/index.js'))
} finally {
  rmSync(bundleDir, { recursive: true, force: true })
}

cpSync(webDist, path.join(out, 'web'), { recursive: true })

const config = parseJsonc(readFileSync(path.join(server, 'wrangler.jsonc'), 'utf8'))
delete config.$schema
config.main = 'worker/index.js'
config.assets = { ...config.assets, directory: 'web' }
// The bundle above is uploaded as built and tested: Wrangler must not bundle it again.
config.no_bundle = true
writeFileSync(path.join(out, 'wrangler.json'), `${JSON.stringify(config, null, 2)}\n`)
// npm ships the license from the package folder.
cpSync(path.join(root, 'LICENSE.md'), path.join(packageDir, 'LICENSE.md'))
console.log(`Orqevio for Cloudflare assembled in ${path.relative(root, out)}/`)
