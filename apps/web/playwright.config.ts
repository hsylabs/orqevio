import { defineConfig, devices } from '@playwright/test'

// E2E_BROWSER=firefox (or webkit, Safari's engine) runs the suite in another engine
// (CI installs them). One per run: the suite expects a fresh copy, and the vault belongs
// to the owner, not to a workspace. Chromium by default.
const ENGINES = { chromium: devices['Desktop Chrome'], firefox: devices['Desktop Firefox'], webkit: devices['Desktop Safari'] }
const browser = (process.env.E2E_BROWSER ?? 'chromium') as keyof typeof ENGINES
if (!(browser in ENGINES)) throw new Error(`E2E_BROWSER must be chromium, firefox or webkit, not ${browser}`)
const viewport = { width: 1440, height: 900 }

/**
 * End-to-end tests run against a running Orqevio server (production build) on
 * an unclaimed copy with a fresh database:
 *   pnpm build && pnpm start          # in another terminal, with SETUP_CODE set (and an empty DATA_DIR)
 *   pnpm test:e2e                     # with the same SETUP_CODE
 * Override the target with E2E_BASE_URL. The "setup" project claims the copy
 * once and the other tests reuse the owner's session; the "uninstall" project
 * runs last, because it deletes the copy.
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
    { name: 'setup', testMatch: 'setup.e2e.ts', use: { ...ENGINES[browser], viewport } },
    {
      name: browser,
      dependencies: ['setup'],
      testIgnore: ['setup.e2e.ts', 'uninstall.e2e.ts'],
      use: { ...ENGINES[browser], viewport, storageState: 'e2e/.auth/owner.json' },
    },
    // Uninstalling deletes the whole copy: once every other test is done.
    { name: 'uninstall', dependencies: [browser], testMatch: 'uninstall.e2e.ts', use: { ...ENGINES[browser], viewport, storageState: 'e2e/.auth/owner.json' } },
  ],
})
