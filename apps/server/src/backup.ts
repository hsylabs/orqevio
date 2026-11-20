import { chownSync, existsSync, lstatSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import Sqlite from 'better-sqlite3'

/**
 * Backups of a copy that runs with Node (Docker or from the code): its SQLite database, copied
 * with SQLite's online backup, so it is whole and consistent even while the app keeps writing.
 * The attachments are files in DATA_DIR/uploads: they are copied as they are.
 */

/**
 * All pages in one step: a step copies one snapshot, while a backup in several steps starts over
 * each time the app writes in between, and with steady writes might never finish. In WAL mode the
 * app keeps writing meanwhile.
 */
const ALL_AT_ONCE = { progress: () => 0x7fffffff }

/** `ok`, or why the file can't be restored: what SQLite's integrity check found, or that it isn't Orqevio's. */
export function checkBackup(file: string): string {
  if (!existsSync(file)) return 'the file does not exist'
  let db: Sqlite.Database
  try {
    db = new Sqlite(file, { readonly: true, fileMustExist: true })
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  try {
    const result = db.pragma('integrity_check', { simple: true })
    if (result !== 'ok') return String(result)
    const orqevio = db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'instance'").get()
    return orqevio ? 'ok' : 'it is not an Orqevio database'
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  } finally {
    db.close()
  }
}

/** Copies the database to `destination` while the app runs, then checks the copy. */
export async function backupDatabase(databasePath: string, destination: string) {
  const target = path.resolve(destination)
  if (target === path.resolve(databasePath)) throw new Error('The backup must go to another file than the database itself.')
  if (!existsSync(path.dirname(target))) throw new Error(`The folder ${path.dirname(target)} does not exist.`)
  const source = new Sqlite(databasePath, { readonly: true, fileMustExist: true })
  try {
    await source.backup(target, ALL_AT_ONCE)
  } finally {
    source.close()
  }
  // One file, without a write-ahead log beside it: what is copied out is the whole backup.
  const copy = new Sqlite(target)
  copy.pragma('journal_mode = DELETE')
  copy.close()
  const check = checkBackup(target)
  if (check !== 'ok') throw new Error(`The backup is not whole: ${check}`)
  return { path: target, bytes: statSync(target).size }
}

/**
 * Puts a backup in place of the database. Only with the app stopped: it would keep using what it
 * had read. The database there now is kept next to it, as `<database>.before-restore`. Run as
 * root (as Docker's `--user root` does), it gives what it restores, the attachments included, to
 * the owner of the data folder, so the app can write to them again.
 */
export async function restoreDatabase(backupPath: string, databasePath: string, uploadsDir: string) {
  const check = checkBackup(backupPath)
  if (check !== 'ok') throw new Error(`This backup can't be restored: ${check}`)
  const target = path.resolve(databasePath)
  if (path.resolve(backupPath) === target) throw new Error('The backup is the database itself: copy it somewhere else first.')
  if (inUse(target)) {
    throw new Error(
      'The app is running and using this database: what it writes from now on would be lost. Stop it first (docker compose stop app), restore with docker compose run --rm --user root app node dist/cli.js restore <file>, then start it again (docker compose start app).',
    )
  }
  // Copied next to the database first, then swapped in: it is never half written.
  const incoming = `${target}.restoring`
  rmSync(incoming, { force: true })
  const source = new Sqlite(backupPath, { readonly: true, fileMustExist: true })
  try {
    await source.backup(incoming, ALL_AT_ONCE)
  } finally {
    source.close()
  }
  const kept = `${target}.before-restore`
  if (existsSync(target)) {
    // What the old database still has in its write-ahead log goes into it before it is set aside.
    try {
      const old = new Sqlite(target, { fileMustExist: true })
      old.pragma('wal_checkpoint(TRUNCATE)')
      old.close()
    } catch {
      // Damaged or locked: it is kept as it is.
    }
    rmSync(kept, { force: true })
    renameSync(target, kept)
  }
  // What is left of the old database's write-ahead log would be applied to the restored one.
  for (const suffix of ['-wal', '-shm']) {
    rmSync(`${target}${suffix}`, { force: true })
    rmSync(`${kept}${suffix}`, { force: true })
  }
  renameSync(incoming, target)
  const owner = statSync(path.dirname(target))
  if (process.getuid?.() === 0) {
    for (const file of [target, kept, ...walk(uploadsDir)]) if (existsSync(file)) chownSync(file, owner.uid, owner.gid)
  }
  return { path: target, kept: existsSync(kept) ? kept : null }
}

/**
 * Whether another process has the database open: the app keeps it in WAL mode, and leaving that
 * mode needs every other connection gone. Done on a database about to be set aside anyway.
 */
function inUse(database: string) {
  if (!existsSync(database)) return false
  let db: Sqlite.Database
  try {
    db = new Sqlite(database, { fileMustExist: true, timeout: 0 })
  } catch {
    return false
  }
  try {
    if (db.pragma('journal_mode', { simple: true }) !== 'wal') return false
    db.pragma('journal_mode = DELETE')
    return db.pragma('journal_mode', { simple: true }) === 'wal'
  } catch (error) {
    return (error as { code?: string }).code === 'SQLITE_BUSY' || /locked|busy/i.test(String(error))
  } finally {
    db.close()
  }
}

/** A folder and everything in it (without following links), or nothing if it doesn't exist. */
function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  const found = [dir]
  for (const name of readdirSync(dir)) {
    const entry = path.join(dir, name)
    if (lstatSync(entry).isDirectory()) found.push(...walk(entry))
    else found.push(entry)
  }
  return found
}
