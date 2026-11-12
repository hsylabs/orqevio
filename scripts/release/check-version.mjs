// Used by the release workflow: node scripts/release/check-version.mjs <version> [--notes <file>]
// Fails unless every package carries <version> and CHANGELOG.md has notes for it;
// with --notes, writes those notes for the GitHub release.
import { writeFileSync } from 'node:fs'
import { SEMVER, currentVersions, releaseNotes } from './versions.mjs'

const [version, flag, notesFile] = process.argv.slice(2)
if (!version || !SEMVER.test(version)) {
  console.error(`"${version}" is not a version (major.minor.patch).`)
  process.exit(2)
}
const wrong = currentVersions().filter(([, found]) => found !== version)
for (const [file, found] of wrong) console.error(`${file}: ${found ?? 'no version'} (expected ${version})`)
const notes = releaseNotes(version)
if (!notes) console.error(`CHANGELOG.md has no notes for ${version}.`)
if (wrong.length || !notes) process.exit(1)
if (flag === '--notes' && notesFile) writeFileSync(notesFile, `${notes}\n`)
console.log(`Version ${version} checked.`)
