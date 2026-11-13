import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { LANGUAGES, ORIGIN, PAGES, build, pathOf } from '../build.mjs'

const root = path.resolve(import.meta.dirname, '..')
const dist = path.join(root, 'dist')
const fileOf = (lang, page) => pathOf(lang, page).replace(/\/$/, '/index.html').slice(1)
const read = (file) => readFileSync(path.join(dist, file), 'utf8')
const attributes = (html, name) => [...html.matchAll(new RegExp(`\\s${name}="([^"]+)"`, 'g'))].map((m) => m[1])
const pages = LANGUAGES.flatMap((lang) => Object.keys(PAGES).map((page) => ({ lang, page, file: fileOf(lang, page) })))

beforeAll(() => {
  build()
})

describe('the public website', () => {
  it('is built in all eight languages of Orqevio, English at the root', () => {
    expect(LANGUAGES).toEqual(['en', 'es', 'fr', 'pt', 'it', 'de', 'nl', 'ja'])
    expect(fileOf('en', 'install')).toBe('install/index.html')
    expect(fileOf('ja', 'privacy')).toBe('ja/privacy/index.html')
  })

  it.each(pages)('$file is a complete page in its language without inline code', ({ lang, file }) => {
    const html = read(file)
    expect(html).toMatch(new RegExp(`^<!doctype html>\\n<html lang="${lang === 'pt' ? 'pt-BR' : lang}">`))
    expect(html).toMatch(/<title>[^<]+<\/title>/)
    expect(html).toMatch(/<meta name="description" content="[^"]{40,}" \/>/)
    expect(html).toContain('<meta name="viewport"')
    expect(html).not.toContain('{{')
    // The CSP allows only files from the site itself.
    expect(html).not.toMatch(/<script(?![^>]*\ssrc="\/)/)
    expect(html).not.toMatch(/\sstyle="/)
    expect(html).not.toMatch(/\son[a-z]+="/)
  })

  it('links every version of a page to the others, and English is the default', () => {
    for (const { lang, page, file } of pages.filter((p) => p.page !== '404')) {
      const html = read(file)
      expect(html, file).toContain(`<link rel="canonical" href="${ORIGIN}${pathOf(lang, page)}" />`)
      for (const other of LANGUAGES) expect(html, file).toContain(`href="${ORIGIN}${pathOf(other, page)}"`)
      expect(html, file).toContain(`<link rel="alternate" hreflang="x-default" href="${ORIGIN}${pathOf('en', page)}" />`)
      // The language list leads to the same page in each language.
      for (const other of LANGUAGES) expect(html, file).toContain(`<a href="${pathOf(other, page)}" hreflang=`)
    }
    expect(read('404.html')).toContain('<meta name="robots" content="noindex" />')
  })

  it('gives every language the same sections, so links between them land in the same place', () => {
    const ids = (file) => attributes(read(file), 'id').sort()
    for (const page of Object.keys(PAGES)) for (const lang of LANGUAGES) expect(ids(fileOf(lang, page)), `${lang} ${page}`).toEqual(ids(fileOf('en', page)))
  })

  it('links only to pages and files that exist, or to https sites', () => {
    for (const { file } of pages) {
      for (const ref of [...attributes(read(file), 'href'), ...attributes(read(file), 'src')]) {
        if (ref.startsWith('#')) {
          expect(read(file), `${file} → ${ref}`).toContain(`id="${ref.slice(1)}"`)
        } else if (ref.startsWith('/')) {
          const [target, hash] = ref.split('#')
          const local = target.endsWith('/') ? `${target}index.html` : target
          expect(existsSync(path.join(dist, local)), `${file} → ${ref}`).toBe(true)
          if (hash) expect(read(local.slice(1)), `${file} → ${ref}`).toContain(`id="${hash}"`)
        } else {
          expect(ref, `${file} → ${ref}`).toMatch(/^https:\/\//)
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

  it.each(LANGUAGES)('%s: the install guide says the same as the READMEs', (lang) => {
    const readme = readFileSync(path.join(root, '../../README.md'), 'utf8')
    const install = read(fileOf(lang, 'install'))
    const button = /\((https:\/\/deploy\.workers\.cloudflare\.com\/\?url=[^)]+)\)/.exec(readme)[1]
    expect(install).toContain(`href="${button}"`)
    for (const command of ['npx create-orqevio', 'npx create-orqevio@latest update', 'npx create-orqevio@latest recover', 'docker compose exec app node dist/cli.js reset-access', '--lang']) {
      expect(readme).toContain(command)
      expect(install).toContain(command)
    }
    // Every guide asks to turn R2 on before the first install in Cloudflare.
    for (const text of [readme, install]) expect(text).toContain('https://dash.cloudflare.com/?to=/:account/r2/overview')
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
