import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests run against a running Orqevio server (production build).
 *   pnpm build && pnpm start          # in another terminal, with DATABASE_URL set
 *   pnpm test:e2e
 * Override the target with E2E_BASE_URL.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'off',
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
})
