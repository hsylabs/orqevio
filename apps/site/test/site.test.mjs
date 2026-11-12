import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const dist = path.join(root, 'dist')
const pages = ['index.html', 'instalar/index.html', 'privacidad/index.html', '404.html']
const read = (file) => readFileSync(path.join(dist, file), 'utf8')
const attributes = (html, name) => [...html.matchAll(new RegExp(`\\s${name}="([^"]+)"`, 'g'))].map((m) => m[1])

beforeAll(() => {
  execFileSync(process.execPath, [path.join(root, 'build.mjs')], { stdio: 'pipe' })
})

describe('the public website', () => {
  it.each(pages)('%s is a complete Spanish page without inline code', (page) => {
    const html = read(page)
    expect(html).toMatch(/^<!doctype html>\n<html lang="es">/)
    expect(html).toMatch(/<title>[^<]+<\/title>/)
    expect(html).toMatch(/<meta name="description" content="[^"]{40,}" \/>/)
    expect(html).toContain('<meta name="viewport"')
    // The CSP allows only files from the site itself.
    expect(html).not.toMatch(/<script(?![^>]*\ssrc="\/)/)
    expect(html).not.toMatch(/\sstyle="/)
    expect(html).not.toMatch(/\son[a-z]+="/)
  })

  it('links only to pages and files that exist, or to https sites', () => {
    for (const page of pages) {
      for (const ref of [...attributes(read(page), 'href'), ...attributes(read(page), 'src')]) {
        if (ref.startsWith('#')) {
          expect(read(page), `${page} → ${ref}`).toContain(`id="${ref.slice(1)}"`)
        } else if (ref.startsWith('/')) {
          const [file, hash] = ref.split('#')
          const target = file.endsWith('/') ? `${file}index.html` : file
          expect(existsSync(path.join(dist, target)), `${page} → ${ref}`).toBe(true)
          if (hash) expect(read(target.slice(1)), `${page} → ${ref}`).toContain(`id="${hash}"`)
        } else {
          expect(ref, `${page} → ${ref}`).toMatch(/^https:\/\//)
        }
      }
    }
  })

  it('serves its own fonts, Latin subsets only', () => {
    const css = read('fonts.css')
    const files = readdirSync(path.join(dist, 'fonts'))
    expect(files.length).toBeGreaterThanOrEqual(6)
    for (const file of files) expect(css).toContain(`url(/fonts/${file})`)
    expect(files.every((file) => /-latin(-ext)?-/.test(file))).toBe(true)
    expect(read('index.html')).toContain('href="/fonts/fraunces-latin-soft-normal.woff2"')
  })

  it('says the same as the README about installing', () => {
    const readme = readFileSync(path.join(root, '../../README.md'), 'utf8')
    const install = read('instalar/index.html')
    const button = /\((https:\/\/deploy\.workers\.cloudflare\.com\/\?url=[^)]+)\)/.exec(readme)[1]
    expect(install).toContain(`href="${button}"`)
    for (const command of ['npx create-orqevio', 'npx create-orqevio@latest update', 'npx create-orqevio@latest recover', 'docker compose exec app node dist/cli.js reset-access']) {
      expect(readme).toContain(command)
      expect(install).toContain(command)
    }
    // The files the Docker guide downloads are in the repository.
    for (const file of ['docker-compose.yml', '.env.example']) {
      expect(install).toContain(`https://raw.githubusercontent.com/hsylabs/orqevio/main/${file}`)
      expect(existsSync(path.join(root, '../..', file))).toBe(true)
    }
  })

  it('sends strict security headers', () => {
    const headers = read('_headers')
    expect(headers).toContain("default-src 'none'; script-src 'self'; style-src 'self'")
    expect(headers).toContain("frame-ancestors 'none'")
  })
})
