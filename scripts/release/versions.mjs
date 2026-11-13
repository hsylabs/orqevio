// The files that carry Orqevio's version. Every release moves all of them at once
// (set-version.mjs) and the release workflow checks they agree (check-version.mjs).
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

const MANIFESTS = [
  'package.json',
  'apps/server/package.json',
  'apps/web/package.json',
  'packages/shared/package.json',
  'packages/orqevio/package.json',
  'packages/create-orqevio/package.json',
]
const SERVER_VERSION = 'apps/server/src/version.ts'
const TEMPLATE = 'templates/cloudflare/package.json'
export const CHANGELOG = 'CHANGELOG.md'
export const UNRELEASED = '## [Sin publicar]'

const read = (file) => readFileSync(path.join(root, file), 'utf8')
const write = (file, text) => writeFileSync(path.join(root, file), text)

/** Every place a version is written, with what it holds now. */
export function currentVersions() {
  const found = MANIFESTS.map((file) => [file, JSON.parse(read(file)).version])
  found.push([SERVER_VERSION, read(SERVER_VERSION).match(/VERSION = '([^']+)'/)?.[1]])
  found.push([`${TEMPLATE} (create-orqevio)`, JSON.parse(read(TEMPLATE)).dependencies['create-orqevio']])
  return found
}

export function setVersions(version) {
  for (const file of MANIFESTS) {
    const manifest = JSON.parse(read(file))
    manifest.version = version
    write(file, `${JSON.stringify(manifest, null, 2)}\n`)
  }
  write(SERVER_VERSION, read(SERVER_VERSION).replace(/VERSION = '[^']+'/, `VERSION = '${version}'`))
  const template = JSON.parse(read(TEMPLATE))
  template.dependencies['create-orqevio'] = version
  write(TEMPLATE, `${JSON.stringify(template, null, 2)}\n`)
}

/** A test version, such as 1.0.0-rc.1. */
export const isPrerelease = (version) => version.includes('-')

function sectionNotes(heading, changelog) {
  const lines = changelog.split('\n')
  const start = lines.findIndex((line) => line.startsWith(heading))
  if (start === -1) return null
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '))
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim() || null
}

/**
 * The notes of one version in CHANGELOG.md, without its heading; null if it has none.
 * A test version without a section of its own ships the unreleased notes, which stay
 * where they are so that the final version gets them all.
 */
export function releaseNotes(version, changelog = read(CHANGELOG)) {
  return sectionNotes(`## [${version}]`, changelog) ?? (isPrerelease(version) ? sectionNotes(UNRELEASED, changelog) : null)
}

/** Turns the unreleased notes into the section of `version`, dated today. */
export function releaseChangelog(version, date, changelog = read(CHANGELOG)) {
  if (!changelog.includes(UNRELEASED)) throw new Error(`${CHANGELOG} has no "${UNRELEASED}" section`)
  if (changelog.includes(`## [${version}]`)) throw new Error(`${CHANGELOG} already has a section for ${version}`)
  return changelog.replace(UNRELEASED, `${UNRELEASED}\n\n## [${version}] - ${date}`)
}

export const writeChangelog = (text) => write(CHANGELOG, text)
export const readChangelog = () => read(CHANGELOG)
