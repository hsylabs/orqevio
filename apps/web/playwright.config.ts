import { defineConfig, devices } from '@playwright/test'

// E2E_BROWSERS=firefox,webkit runs the suite in other engines (CI installs them);
// the first one also claims the copy. Chromium alone by default.
const ENGINES = { chromium: devices['Desktop Chrome'], firefox: devices['Desktop Firefox'], webkit: devices['Desktop Safari'] }
type Engine = keyof typeof ENGINES
const browsers = (process.env.E2E_BROWSERS ?? 'chromium').split(',').map((b) => b.trim()) as Engine[]
for (const b of browsers) if (!(b in ENGINES)) throw new Error(`Unknown browser in E2E_BROWSERS: ${b}`)
const viewport = { width: 1440, height: 900 }

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
    { name: 'setup', testMatch: 'setup.e2e.ts', use: { ...ENGINES[browsers[0]!], viewport } },
    ...browsers.map((name) => ({
      name,
      dependencies: ['setup'],
      testIgnore: 'setup.e2e.ts',
      use: { ...ENGINES[name], viewport, storageState: 'e2e/.auth/owner.json' },
    })),
  ],
})
