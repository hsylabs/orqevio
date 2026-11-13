import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseJsonc } from '../src/jsonc'
import { templatePackageJson, templateWranglerConfig } from '../src/template'

const root = path.resolve(import.meta.dirname, '../../..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')
const installer = JSON.parse(read('packages/create-orqevio/package.json')) as { version: string }

// Run `pnpm --filter create-orqevio test -u` to regenerate them after changing apps/server/wrangler.jsonc.
describe('Deploy to Cloudflare template', () => {
  it('has the wrangler.jsonc derived from the server configuration', async () => {
    await expect(templateWranglerConfig(read('apps/server/wrangler.jsonc'))).toMatchFileSnapshot(path.join(root, 'templates/cloudflare/wrangler.jsonc'))
  })

  it('depends on the current installer version', async () => {
    await expect(templatePackageJson(installer.version)).toMatchFileSnapshot(path.join(root, 'templates/cloudflare/package.json'))
  })

  it('asks for the setup code when the repository is created', () => {
    const example = read('templates/cloudflare/.dev.vars.example')
    expect(example).toMatch(/^SETUP_CODE=/m)
    const config = parseJsonc(read('templates/cloudflare/wrangler.jsonc')) as { secrets: { required: string[] } }
    expect(config.secrets.required).toEqual(['SETUP_CODE'])
  })
})
