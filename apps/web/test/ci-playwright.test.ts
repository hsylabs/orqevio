import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8')
const { devDependencies } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { devDependencies: Record<string, string> }

// CI's end-to-end jobs run in Playwright's image, which holds the browsers of one Playwright
// version: with another, the tests find no browser to run. Moving @playwright/test means moving
// the image too.
describe("CI's end-to-end jobs", () => {
  it('run in the Playwright image of the version the tests use', () => {
    const images = [...workflow.matchAll(/mcr\.microsoft\.com\/playwright:v([^\s-]+)-/g)].map((match) => match[1])
    expect(images.length).toBeGreaterThan(0)
    expect(devDependencies['@playwright/test']).toMatch(/^\d+\.\d+\.\d+$/)
    for (const version of images) expect(version, 'the image in ci.yml and @playwright/test in apps/web/package.json').toBe(devDependencies['@playwright/test'])
  })
})
