import { mkdir } from 'node:fs/promises'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { createDatabase, runMigrations } from './db/client'
import { loadEnv } from './env'
import { RealtimeBus } from './lib/realtime'
import { LocalStorage } from './lib/storage'
import { createServices } from './services'

const env = loadEnv()
const { db, pool } = createDatabase(env.databaseUrl)

await runMigrations(db, env.migrationsDir)
await mkdir(env.dataDir, { recursive: true })

const bus = new RealtimeBus(env.databaseUrl, pool)
await bus.start()

const storage = new LocalStorage(`${env.dataDir}/uploads`)
const services = createServices({ db, bus, env, storage })
const app = createApp(env, services)

const server = serve({ fetch: app.fetch, port: env.port, hostname: env.host }, (info) => {
  console.log(`Orqevio listening on http://${info.address}:${info.port} (public URL ${env.appUrls[0]})`)
})

const sweep = setInterval(() => {
  services.attachments.sweepOrphans().catch((error) => console.error('[storage] sweep failed', error))
}, 60 * 60 * 1000)
sweep.unref()

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`)
  clearInterval(sweep)
  server.close()
  await bus.stop()
  await pool.end()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
