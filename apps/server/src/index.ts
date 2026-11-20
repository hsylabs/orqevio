import { mkdir } from 'node:fs/promises'
import type { Server } from 'node:http'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { MIN_SETUP_CODE_LENGTH, isWeakSetupCode } from './auth/crypto'
import { FolderBackupStore, describeBackupProblem } from './backups/store'
import { openDatabase, runMigrations } from './db/client'
import { nodeSql } from './db/raw'
import { configWarnings, loadEnvOrExit } from './env'
import { RealtimeBus } from './lib/realtime'
import { LocalStorage } from './lib/storage-local'
import { keepConnectionsOpen } from './node/keep-alive'
import { attachLiveUpdates } from './node/live'
import { nodePlatform } from './node/platform'
import { publicFetch } from './node/public-fetch'
import { createServices } from './services'

const env = loadEnvOrExit()
for (const warning of configWarnings(env)) console.warn(warning)
await mkdir(env.dataDir, { recursive: true })
await mkdir(path.dirname(env.databasePath), { recursive: true })
const { db, sqlite, close } = openDatabase(env.databasePath)
runMigrations(db, env.migrationsDir)

const bus = new RealtimeBus()

const storage = new LocalStorage(`${env.dataDir}/uploads`)
const backups = env.backupDir ? new FolderBackupStore(env.backupDir) : null
const services = createServices({ db, bus, env, storage, publicFetch, sql: nodeSql(sqlite), backups, migrate: () => runMigrations(db, env.migrationsDir) })
const app = createApp(env, services, nodePlatform(env))

const server = serve({ fetch: app.fetch, port: env.port, hostname: env.host }, (info) => {
  console.log(`Orqevio listening on http://${info.address}:${info.port} (public URL ${env.appUrls[0]})`)
})
keepConnectionsOpen(server as Server)
const live = attachLiveUpdates(server as Server, env, services, bus)

if (env.setupCode && isWeakSetupCode(env.setupCode)) {
  console.error(
    `SETUP_CODE has fewer than ${MIN_SETUP_CODE_LENGTH} letters A–Z or digits (other characters don't count): this copy can't be claimed or recovered with it. Set a longer one.`,
  )
}
if (env.backupDir) {
  console.log(`Daily backups go to ${env.backupDir}`)
  // A folder that isn't this user's (mounted, or copied in by root) would fail every hour in silence.
  const problem = await backups?.check()
  if (problem) console.warn(describeBackupProblem(problem, env.backupDir))
} else console.log('Backups are off (BACKUPS=off)')
const uninstalled = await services.accounts.uninstalled()
if (uninstalled) {
  console.log(`This copy of Orqevio was uninstalled (${uninstalled.at}). Remove its container and data to finish: it can't be claimed again.`)
}
const setup = await services.accounts.setupNotice()
if (setup) {
  console.log(`This copy is not claimed yet. Open ${env.appUrls[0]} to set it up.`)
  if (setup.generatedCode) console.log(`Setup code: ${setup.generatedCode} (valid until the copy is claimed or the server restarts)`)
  else console.log('Use the setup code configured in SETUP_CODE.')
}

// Hourly: what has been in the trash or the history for 30 days goes for good, then files nothing
// uses; and once a day, a backup.
const hourly = () =>
  services.trash
    .purgeExpired()
    .catch((error) => console.error('[trash] purge failed', error))
    .then(() => services.history.purgeExpired())
    .catch((error) => console.error('[history] purge failed', error))
    .then(() => services.attachments.sweepOrphans())
    .catch((error) => console.error('[storage] sweep failed', error))
    .then(() => services.backups.runIfDue())
    .catch((error) => console.error('[backups] backup failed', error))
const sweep = setInterval(hourly, 60 * 60 * 1000)
sweep.unref()
// A server restarted every day still makes its backup: the first check comes a minute after starting.
const firstCheck = setTimeout(() => void services.backups.runIfDue().catch((error) => console.error('[backups] backup failed', error)), 60 * 1000)
firstCheck.unref()

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`)
  clearInterval(sweep)
  clearTimeout(firstCheck)
  for (const client of live.clients) client.close(1001, 'server_shutdown')
  server.close()
  close()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
