import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Sqlite from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { backupDatabase, checkBackup, restoreDatabase } from '../src/backup'
import { openDatabase, runMigrations } from '../src/db/client'

const MIGRATIONS = path.join(import.meta.dirname, '../drizzle')
const folders: string[] = []
afterEach(() => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A data folder with a migrated database, as a copy has once it starts. */
function copy() {
  const dir = mkdtempSync(path.join(tmpdir(), 'orqevio-backup-'))
  folders.push(dir)
  const file = path.join(dir, 'orqevio.db')
  const opened = openDatabase(file)
  runMigrations(opened.db, MIGRATIONS)
  opened.sqlite.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
  return { dir, file, ...opened }
}

const count = (file: string) => {
  const db = new Sqlite(file, { readonly: true })
  const { n } = db.prepare('SELECT count(*) AS n FROM notes').get() as { n: number }
  db.close()
  return n
}

describe('backups with Node', () => {
  it('copies the database whole while the app keeps writing', async () => {
    const live = copy()
    const insert = live.sqlite.prepare('INSERT INTO notes (body) VALUES (?)')
    for (let i = 0; i < 3000; i++) insert.run('x'.repeat(400))
    // The app goes on writing, from its own connection, while the backup runs.
    let writes = 0
    const writer = setInterval(() => {
      for (let i = 0; i < 20; i++) insert.run('y'.repeat(400))
      writes++
    }, 0)
    const done = await backupDatabase(live.file, path.join(live.dir, 'backup.db'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    clearInterval(writer)

    expect(done.bytes).toBeGreaterThan(1_000_000)
    expect(checkBackup(done.path)).toBe('ok')
    // One file to copy out: no write-ahead log beside it, even after reading it.
    expect(existsSync(`${done.path}-wal`)).toBe(false)
    expect(count(done.path)).toBeGreaterThanOrEqual(3000)
    expect(writes).toBeGreaterThan(0)
    // The app's database is untouched and still writable.
    insert.run('after')
    expect(count(live.file)).toBe(3000 + writes * 20 + 1)
    live.close()
  })

  it('refuses to back up over the database itself or into a missing folder', async () => {
    const live = copy()
    await expect(backupDatabase(live.file, live.file)).rejects.toThrow('another file')
    await expect(backupDatabase(live.file, path.join(live.dir, 'missing', 'backup.db'))).rejects.toThrow('does not exist')
    live.close()
  })

  it('puts a backup back in place of the database, keeping the one it replaces', async () => {
    const live = copy()
    const insert = live.sqlite.prepare('INSERT INTO notes (body) VALUES (?)')
    insert.run('kept in the backup')
    const backup = await backupDatabase(live.file, path.join(live.dir, 'backup.db'))
    insert.run('written after the backup')
    // Stopped without checkpointing: the newest write is only in the write-ahead log.
    expect(existsSync(`${live.file}-wal`)).toBe(true)
    live.close()

    const done = await restoreDatabase(backup.path, live.file, path.join(live.dir, 'uploads'))
    // No log of the old database is left for the restored one to pick up.
    expect(existsSync(`${live.file}-wal`)).toBe(false)
    expect(count(live.file)).toBe(1)
    expect(checkBackup(live.file)).toBe('ok')
    // What it replaced is kept whole, including what was only in its log.
    expect(done.kept).toBe(`${live.file}.before-restore`)
    expect(count(done.kept!)).toBe(2)
    // The app opens the restored database and carries on.
    const reopened = openDatabase(live.file)
    runMigrations(reopened.db, MIGRATIONS)
    reopened.sqlite.prepare('INSERT INTO notes (body) VALUES (?)').run('after restoring')
    expect(count(live.file)).toBe(2)
    reopened.close()
  })

  it('restores only an intact Orqevio database', async () => {
    const live = copy()
    live.close()
    const other = path.join(live.dir, 'other.db')
    const db = new Sqlite(other)
    db.exec('CREATE TABLE things (id INTEGER)')
    db.close()
    const garbage = path.join(live.dir, 'garbage.db')
    writeFileSync(garbage, 'not a database at all, just text')
    mkdirSync(path.join(live.dir, 'uploads'))

    for (const [file, reason] of [
      [other, 'not an Orqevio database'],
      [garbage, 'not a database'],
      [path.join(live.dir, 'missing.db'), 'does not exist'],
      [live.file, 'the database itself'],
    ] as const) {
      await expect(restoreDatabase(file, live.file, path.join(live.dir, 'uploads')), file).rejects.toThrow(reason)
    }
    expect(checkBackup(live.file)).toBe('ok')
    expect(existsSync(`${live.file}.before-restore`)).toBe(false)
  })
})
