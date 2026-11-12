/**
 * Administration CLI for whoever runs this copy of Orqevio.
 *   node dist/cli.js status         Shows whether the copy is claimed and by whom.
 *   node dist/cli.js reset-access   Issues a new access key and signs out every session.
 * The vault is unaffected: its master password is never known to the server.
 */
import { eq } from 'drizzle-orm'
import { generateAccessKey, secretFingerprint } from './auth/crypto'
import { createDatabase } from './db/client'
import { instance, sessions, users } from './db/schema'
import { loadEnv } from './env'

const [command] = process.argv.slice(2)
const env = loadEnv()
const { db, pool } = createDatabase(env.databaseUrl)

try {
  const [row] = await db
    .select({ ownerId: instance.ownerId, name: users.name, claimedAt: instance.claimedAt, keyChangedAt: instance.keyChangedAt })
    .from(instance)
    .innerJoin(users, eq(users.id, instance.ownerId))
  if (command === 'status') {
    if (!row) console.log('This copy is not claimed yet. Open it in a browser and enter the setup code.')
    else {
      console.log(`Owner: ${row.name}`)
      console.log(`Claimed: ${row.claimedAt.toISOString()}`)
      console.log(`Access key last changed: ${row.keyChangedAt.toISOString()}`)
    }
  } else if (command === 'reset-access') {
    if (!row) {
      console.error('This copy is not claimed yet: there is no access key to reset.')
      process.exitCode = 1
    } else {
      const accessKey = generateAccessKey()
      await db.transaction(async (tx) => {
        await tx.update(instance).set({ accessKeyHash: secretFingerprint(accessKey), keyChangedAt: new Date() }).where(eq(instance.id, 1))
        await tx.delete(sessions).where(eq(sessions.userId, row.ownerId))
      })
      console.log(`New access key: ${accessKey}`)
      console.log('Every session was signed out. Save the key in a password manager; it is not shown again.')
    }
  } else {
    console.log('Usage:\n  node dist/cli.js status\n  node dist/cli.js reset-access')
    process.exitCode = command ? 1 : 0
  }
} finally {
  await pool.end()
}
