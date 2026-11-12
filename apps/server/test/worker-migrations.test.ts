import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import embedded from '../src/worker/migrations.gen'

describe('Cloudflare runtime', () => {
  it('embeds the current Drizzle migrations (run `pnpm db:generate` after changing the schema)', () => {
    const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'))
    expect(embedded.journal.entries).toEqual(journal.entries)
    for (const entry of journal.entries) {
      const sql = readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), 'utf8')
      expect(embedded.migrations[`m${String(entry.idx).padStart(4, '0')}` as keyof typeof embedded.migrations]).toBe(sql)
    }
  })
})
