/**
 * Administration CLI (self-hosted operators).
 *   node dist/cli.js reset-password <email>   Sets a random temporary password and signs out all sessions.
 *   node dist/cli.js list-users               Lists accounts.
 * The vault is unaffected: its master password is never known to the server.
 */
import { randomBytes } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { hashPassword } from './auth/crypto'
import { createDatabase } from './db/client'
import { sessions, users } from './db/schema'
import { loadEnv } from './env'

const [command, arg] = process.argv.slice(2)
const env = loadEnv()
const { db, pool } = createDatabase(env.databaseUrl)

try {
  if (command === 'reset-password' && arg) {
    const email = arg.trim().toLowerCase()
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
    if (!user) {
      console.error(`No account found for ${email}`)
      process.exitCode = 1
    } else {
      const temporary = randomBytes(12).toString('base64url')
      await db.update(users).set({ passwordHash: await hashPassword(temporary), updatedAt: new Date() }).where(eq(users.id, user.id))
      await db.delete(sessions).where(eq(sessions.userId, user.id))
      console.log(`Temporary password for ${email}: ${temporary}`)
      console.log('All sessions were signed out. Ask the user to change it in Settings after signing in.')
    }
  } else if (command === 'list-users') {
    const rows = await db.select({ email: users.email, name: users.name, createdAt: users.createdAt }).from(users).orderBy(asc(users.createdAt))
    for (const r of rows) console.log(`${r.createdAt.toISOString()}  ${r.email}  ${r.name}`)
  } else {
    console.log('Usage:\n  node dist/cli.js reset-password <email>\n  node dist/cli.js list-users')
    process.exitCode = command ? 1 : 0
  }
} finally {
  await pool.end()
}
