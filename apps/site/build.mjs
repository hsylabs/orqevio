// Builds the public website into dist/: the pages in src/ as they are, plus the
// app's own fonts (Latin subsets only), served from the site itself.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname)
const dist = path.join(here, 'dist')
const require = createRequire(import.meta.url)

rmSync(dist, { recursive: true, force: true })
cpSync(path.join(here, 'src'), dist, { recursive: true })
mkdirSync(path.join(dist, 'fonts'), { recursive: true })

const sources = ['@fontsource-variable/fraunces/soft.css', '@fontsource-variable/instrument-sans/wght.css', '@fontsource-variable/jetbrains-mono/wght.css']
const faces = []
for (const source of sources) {
  const file = require.resolve(source)
  for (const face of readFileSync(file, 'utf8').match(/@font-face\s*{[^}]*}/g) ?? []) {
    const url = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(face)?.[1]
    if (!url || !/-latin(-ext)?-/.test(url)) continue
    cpSync(path.join(path.dirname(file), 'files', url), path.join(dist, 'fonts', url))
    faces.push(face.replace(/url\(\.\/files\/[^)]+\.woff2\)/, `url(/fonts/${url})`).replace(/font-display:\s*\w+/, 'font-display: swap'))
  }
}
writeFileSync(path.join(dist, 'fonts.css'), `${faces.join('\n')}\n`)
console.log(`Built the site with ${faces.length} font faces`)
