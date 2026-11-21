import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8')
const { devDependencies } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { devDependencies: Record<string, string> }

// CI's end-to-end jobs run in Playwright's image, which holds the browsers of one Playwright
// version: with another, the tests find no browser to run. Moving @playwright/test means moving
// the image too.
describe("CI's end-to-end jobs", () => {
  it('run in the Playwright image of the version the tests use', () => {
    const version = devDependencies['@playwright/test']
    expect(version, 'an exact version, as the image has one').toMatch(/^\d+\.\d+\.\d+$/)
    // Every tag the image is named with, written in any way: each must be that version (and its Ubuntu, if named).
    const tags = [...workflow.matchAll(/mcr\.microsoft\.com\/playwright:([^\s"'@]+)/g)].map((match) => match[1])
    expect(tags.length).toBeGreaterThan(0)
    for (const tag of tags) expect(tag, 'the image in ci.yml and @playwright/test in apps/web/package.json').toMatch(new RegExp(`^v${version.replaceAll('.', '\\.')}(-[a-z]+)?$`))
  })
})
