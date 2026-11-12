import { chmodSync, copyFileSync } from 'node:fs'
import { build } from 'esbuild'

await build({
  entryPoints: { cli: 'src/cli.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
})
chmodSync('dist/cli.js', 0o755)
// npm ships the license from the package folder.
copyFileSync('../../LICENSE.md', 'LICENSE.md')
