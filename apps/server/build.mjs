import { readFileSync } from 'node:fs'
import { cp, rm } from 'node:fs/promises'
import { build } from 'esbuild'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
// Bundle workspace packages (TypeScript sources); keep real dependencies external.
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@orqevio/'))

await rm('dist', { recursive: true, force: true })
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external,
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
})
await cp('drizzle', 'dist/drizzle', { recursive: true })
