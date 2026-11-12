import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests run against a running Orqevio server (production build) on
 * an unclaimed copy with a fresh database:
 *   pnpm build && pnpm start          # in another terminal, with SETUP_CODE set (and an empty DATA_DIR)
 *   pnpm test:e2e                     # with the same SETUP_CODE
 * Override the target with E2E_BASE_URL. The "setup" project claims the copy
 * once and the other tests reuse the owner's session.
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
  projects: [
    { name: 'setup', testMatch: 'setup.e2e.ts', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      name: 'chromium',
      dependencies: ['setup'],
      testIgnore: 'setup.e2e.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: 'e2e/.auth/owner.json' },
    },
  ],
})
