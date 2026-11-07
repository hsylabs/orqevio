import { loadEnv } from '../env'
import { createDatabase, runMigrations } from './client'

const env = loadEnv()
const { db, pool } = createDatabase(env.databaseUrl)
await runMigrations(db, env.migrationsDir)
await pool.end()
console.log('Migrations applied')
