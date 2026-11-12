import { describe, expect, it } from 'vitest'
import { currentVersions, releaseChangelog, releaseNotes } from '../../../scripts/release/versions.mjs'
import { VERSION } from '../src/version'

describe('releases', () => {
  it('keep every package on the same version', () => {
    const versions = currentVersions()
    expect(new Set(versions.map(([, version]) => version))).toEqual(new Set([VERSION]))
    expect(versions.length).toBeGreaterThanOrEqual(8)
  })

  it('turn the unreleased notes into a dated section and read them back', () => {
    const changelog = '# Registro de cambios\n\n## [Sin publicar]\n\n- Algo nuevo.\n\n## [0.1.0] - 2026-11-12\n\n- Primera versión.\n'
    const released = releaseChangelog('0.2.0', '2026-12-01', changelog)
    expect(released).toContain('## [Sin publicar]\n\n## [0.2.0] - 2026-12-01\n\n- Algo nuevo.')
    expect(releaseNotes('0.2.0', released)).toBe('- Algo nuevo.')
    expect(releaseNotes('0.1.0', released)).toBe('- Primera versión.')
    expect(releaseNotes('0.3.0', released)).toBeNull()
    expect(() => releaseChangelog('0.1.0', '2026-12-01', changelog)).toThrow(/already has a section/)
    expect(() => releaseChangelog('0.2.0', '2026-12-01', '# Registro de cambios\n')).toThrow(/Sin publicar/)
  })
})
