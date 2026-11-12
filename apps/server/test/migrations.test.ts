import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(new URL(`../drizzle/${file}`, import.meta.url), 'utf8')

describe('migrations', () => {
  it('never change once recorded: every copy applies them when it starts', () => {
    const journal = JSON.parse(read('meta/_journal.json')) as { entries: Array<{ tag: string }> }
    const checksums = JSON.parse(read('checksums.json')) as Record<string, string>
    for (const { tag } of journal.entries) {
      // A missing entry means the migration is new: `pnpm db:generate` records it.
      expect(checksums[tag], `${tag} is not recorded in drizzle/checksums.json`).toBeDefined()
      // A different fingerprint means a published migration was edited: add a new one instead.
      expect(createHash('sha256').update(read(`${tag}.sql`)).digest('hex'), `${tag}.sql was edited`).toBe(checksums[tag])
    }
  })
})
