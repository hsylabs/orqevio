// Builds the public website into dist/. Each language has its texts in src/i18n/<lang>.json
// and its pages in src/pages/<lang>/; every page is put into src/layout.html. English lives
// at the root (/, /install/, /privacy/) and every other language under /<lang>/, with
// hreflang links between the versions of a page. Fonts are the app's own, Latin subsets only.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname)
const src = path.join(here, 'src')
const dist = path.join(here, 'dist')
const require = createRequire(import.meta.url)

export const ORIGIN = 'https://orqevio.com'
/** The languages of Orqevio, in the order of the language list; a language is built once its texts exist. */
export const LANGUAGES = ['en', 'es', 'fr', 'pt', 'it', 'de', 'nl', 'ja'].filter((lang) => existsSync(path.join(src, 'i18n', `${lang}.json`)))
/** Portuguese is written for Brazil. */
const TAGS = { pt: 'pt-BR' }
const OG_LOCALES = { en: 'en_US', es: 'es_ES', fr: 'fr_FR', pt: 'pt_BR', it: 'it_IT', de: 'de_DE', nl: 'nl_NL', ja: 'ja_JP' }
/** Each page and where it goes, relative to the language's root. */
export const PAGES = { home: '', install: 'install/', privacy: 'privacy/', 404: '404.html' }

const tag = (lang) => TAGS[lang] ?? lang
const base = (lang) => (lang === 'en' ? '' : `/${lang}`)
export const pathOf = (lang, page) => `${base(lang)}/${PAGES[page]}`
const fileOf = (lang, page) => path.join(dist, pathOf(lang, page).replace(/\/$/, '/index.html'))
const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const escapeAll = (node) => (typeof node === 'string' ? escape(node) : Object.fromEntries(Object.entries(node).map(([key, value]) => [key, escapeAll(value)])))

function fill(template, values, where) {
  const out = template.replace(/\{\{([\w.]+)\}\}/g, (match, key) => {
    const value = key.split('.').reduce((node, part) => node?.[part], values)
    if (typeof value !== 'string') throw new Error(`${where}: nothing for ${match}`)
    return value
  })
  return out
}

function head(lang, page, texts) {
  const lines = []
  if (page === '404') {
    lines.push('<meta name="robots" content="noindex" />')
  } else {
    lines.push(`<link rel="canonical" href="${ORIGIN}${pathOf(lang, page)}" />`)
    for (const other of LANGUAGES) lines.push(`<link rel="alternate" hreflang="${tag(other)}" href="${ORIGIN}${pathOf(other, page)}" />`)
    lines.push(`<link rel="alternate" hreflang="x-default" href="${ORIGIN}${pathOf('en', page)}" />`)
  }
  if (page === 'home') {
    lines.push(
      '<meta property="og:title" content="Orqevio" />',
      `<meta property="og:description" content="${escape(texts.pages.home.share)}" />`,
      '<meta property="og:type" content="website" />',
      `<meta property="og:url" content="${ORIGIN}${pathOf(lang, page)}" />`,
      `<meta property="og:locale" content="${OG_LOCALES[lang]}" />`,
      ...LANGUAGES.filter((other) => other !== lang).map((other) => `<meta property="og:locale:alternate" content="${OG_LOCALES[other]}" />`),
      '<link rel="preload" href="/fonts/fraunces-latin-soft-normal.woff2" as="font" type="font/woff2" crossorigin />',
    )
  }
  return lines.map((line) => `    ${line}`).join('\n')
}

/**
 * Links to other sites open in a new tab and say so to screen readers. Links within the
 * site, the language list included, stay in the same tab.
 */
function openOutsideInNewTab(html, label) {
  return html.replace(/<a\s([^>]*?)href="(https:\/\/[^"]+)"([^>]*)>([\s\S]*?)<\/a>/g, (anchor, before, href, after, inner) =>
    new URL(href).origin === ORIGIN
      ? anchor
      : `<a ${before}href="${href}"${after} target="_blank" rel="noopener">${inner}<span class="visually-hidden"> ${label}</span></a>`,
  )
}

/** Links to this page in every language, each named in its own language. */
function languages(lang, page, all) {
  // The 404 page has no versions of its own: offer each language's home.
  const target = page === '404' ? 'home' : page
  return LANGUAGES.map((other) => {
    const current = other === lang ? ' aria-current="true"' : ''
    return `          <a href="${pathOf(other, target)}" hreflang="${tag(other)}" lang="${tag(other)}"${current}>${all[other].name}</a>`
  }).join('\n')
}

export function build() {
  rmSync(dist, { recursive: true, force: true })
  mkdirSync(dist, { recursive: true })
  for (const file of ['_headers', 'favicon.svg', 'site.css', 'site.js']) cpSync(path.join(src, file), path.join(dist, file))
  const layout = readFileSync(path.join(src, 'layout.html'), 'utf8')
  const all = Object.fromEntries(LANGUAGES.map((lang) => [lang, JSON.parse(readFileSync(path.join(src, 'i18n', `${lang}.json`), 'utf8'))]))
  for (const lang of LANGUAGES) {
    const texts = all[lang]
    for (const page of Object.keys(PAGES)) {
      const where = `${lang}/${page}`
      const content = fill(readFileSync(path.join(src, 'pages', lang, `${page}.html`), 'utf8'), { base: base(lang) }, where).replace(/\n$/, '')
      const meta = texts.pages[page]
      const current = Object.fromEntries(['install', 'privacy'].map((p) => [p, p === page ? ' aria-current="page"' : '']))
      const html = fill(
        layout,
        {
          // The texts of the layout are plain text; the pages are HTML already.
          ...escapeAll(texts),
          htmlLang: tag(lang),
          base: base(lang),
          title: escape(meta.title),
          description: escape(meta.description),
          head: head(lang, page, texts),
          current,
          languages: languages(lang, page, all),
          content: content
            .split('\n')
            .map((line) => (line ? `    ${line}` : line))
            .join('\n'),
        },
        where,
      )
      mkdirSync(path.dirname(fileOf(lang, page)), { recursive: true })
      writeFileSync(fileOf(lang, page), openOutsideInNewTab(html, escape(texts.newTab)))
    }
  }

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
  console.log(`Built the site in ${LANGUAGES.length} languages with ${faces.length} font faces`)
}

if (import.meta.url === `file://${process.argv[1]}`) build()
