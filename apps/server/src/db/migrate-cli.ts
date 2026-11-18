import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { loadEnvOrExit } from '../env'
import { openDatabase, runMigrations } from './client'

const env = loadEnvOrExit()
mkdirSync(path.dirname(env.databasePath), { recursive: true })
const { db, close } = openDatabase(env.databasePath)
runMigrations(db, env.migrationsDir)
close()
console.log('Migrations applied')
