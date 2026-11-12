import { mkdir } from 'node:fs/promises'
import type { Server } from 'node:http'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { normalizeSecret } from './auth/crypto'
import { openDatabase, runMigrations } from './db/client'
import { loadEnv } from './env'
import { RealtimeBus } from './lib/realtime'
import { LocalStorage } from './lib/storage-local'
import { attachLiveUpdates } from './node/live'
import { nodePlatform } from './node/platform'
import { publicFetch } from './node/public-fetch'
import { createServices } from './services'

const env = loadEnv()
await mkdir(env.dataDir, { recursive: true })
await mkdir(path.dirname(env.databasePath), { recursive: true })
const { db, close } = openDatabase(env.databasePath)
runMigrations(db, env.migrationsDir)

const bus = new RealtimeBus()

const storage = new LocalStorage(`${env.dataDir}/uploads`)
const services = createServices({ db, bus, env, storage, publicFetch })
const app = createApp(env, services, nodePlatform(env))

const server = serve({ fetch: app.fetch, port: env.port, hostname: env.host }, (info) => {
  console.log(`Orqevio listening on http://${info.address}:${info.port} (public URL ${env.appUrls[0]})`)
})
const live = attachLiveUpdates(server as Server, env, services, bus)

if (env.setupCode && normalizeSecret(env.setupCode).length < 12) {
  console.warn('SETUP_CODE has fewer than 12 letters or digits; choose a longer one.')
}
const setup = await services.accounts.setupNotice()
if (setup) {
  console.log(`This copy is not claimed yet. Open ${env.appUrls[0]} to set it up.`)
  if (setup.generatedCode) console.log(`Setup code: ${setup.generatedCode} (valid until the copy is claimed or the server restarts)`)
  else console.log('Use the setup code configured in SETUP_CODE.')
}

const sweep = setInterval(() => {
  services.attachments.sweepOrphans().catch((error) => console.error('[storage] sweep failed', error))
}, 60 * 60 * 1000)
sweep.unref()

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`)
  clearInterval(sweep)
  for (const client of live.clients) client.close(1001, 'server_shutdown')
  server.close()
  close()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
