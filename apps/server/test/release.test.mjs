import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { currentVersions, isPrerelease, releaseChangelog, releaseNotes } from '../../../scripts/release/versions.mjs'
import { VERSION } from '../src/version'

describe('releases', () => {
  it('keep every package on the same version', () => {
    const versions = currentVersions()
    expect(new Set(versions.map(([, version]) => version))).toEqual(new Set([VERSION]))
    expect(versions.length).toBeGreaterThanOrEqual(8)
  })

  it('publish packages whose repository matches this one, as npm provenance requires', () => {
    for (const name of ['orqevio', 'create-orqevio']) {
      const manifest = JSON.parse(readFileSync(new URL(`../../../packages/${name}/package.json`, import.meta.url), 'utf8'))
      expect(manifest.repository).toEqual({ type: 'git', url: 'git+https://github.com/hsylabs/orqevio.git', directory: `packages/${name}` })
    }
  })

  it('turn the unreleased notes into a dated section and read them back', () => {
    const changelog = '# Changelog\n\n## [Unreleased]\n\n- Something new.\n\n## [0.1.0] - 2026-11-12\n\n- First release.\n'
    const released = releaseChangelog('0.2.0', '2026-12-01', changelog)
    expect(released).toContain('## [Unreleased]\n\n## [0.2.0] - 2026-12-01\n\n- Something new.')
    expect(releaseNotes('0.2.0', released)).toBe('- Something new.')
    expect(releaseNotes('0.1.0', released)).toBe('- First release.')
    expect(releaseNotes('0.3.0', released)).toBeNull()
    expect(() => releaseChangelog('0.1.0', '2026-12-01', changelog)).toThrow(/already has a section/)
    expect(() => releaseChangelog('0.2.0', '2026-12-01', '# Changelog\n')).toThrow(/Unreleased/)
  })

  it('give a test version the unreleased notes and keep them for the final one', () => {
    const changelog = '# Changelog\n\n## [Unreleased]\n\n- Something new.\n\n## [0.1.0] - 2026-11-12\n\n- First release.\n'
    expect(isPrerelease('0.2.0-rc.1')).toBe(true)
    expect(isPrerelease('0.2.0')).toBe(false)
    expect(releaseNotes('0.2.0-rc.1', changelog)).toBe('- Something new.')
    // The final version still needs its own section, which takes all the notes.
    expect(releaseNotes('0.2.0', changelog)).toBeNull()
    const final = releaseChangelog('0.2.0', '2026-12-01', changelog)
    expect(releaseNotes('0.2.0', final)).toBe('- Something new.')
    expect(releaseNotes('0.2.0-rc.2', final)).toBeNull()
  })
})
