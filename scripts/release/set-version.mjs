// Prepares a release: node scripts/release/set-version.mjs 0.2.0
// Moves every package to the version and turns the "Sin publicar" notes of
// CHANGELOG.md into that version's section. Review the notes, open a PR, and
// push the tag v<version> once it is on main (see RELEASING.md).
import { SEMVER, readChangelog, releaseChangelog, releaseNotes, setVersions, writeChangelog } from './versions.mjs'

const version = process.argv[2]
if (!version || !SEMVER.test(version)) {
  console.error('Usage: node scripts/release/set-version.mjs <major.minor.patch>')
  process.exit(2)
}
const changelog = releaseChangelog(version, new Date().toISOString().slice(0, 10), readChangelog())
if (!releaseNotes(version, changelog)) {
  console.error(`The "Sin publicar" section of CHANGELOG.md is empty: write the notes of ${version} first.`)
  process.exit(1)
}
writeChangelog(changelog)
setVersions(version)
console.log(`Orqevio is now ${version}. Review CHANGELOG.md, then run pnpm install to refresh the lockfile.`)
