// Playwright config for Miharbor e2e smoke.
//
// Topology (all local, no Docker):
//   mock-mihomo (Bun server) ─── http://127.0.0.1:19999
//       ▲
//       │ reload / version / proxies
//       │
//   miharbor-server (Elysia) ─── http://127.0.0.1:4101
//       │ serves API + SPA bundle
//       ▼
//   Playwright (chromium) hits http://127.0.0.1:4101/
//
// The `webServer` array boots both services in parallel; Playwright blocks
// until each `url` responds 2xx. Auth is disabled via ENV so tests don't
// need to handle Basic Auth prompts.
//
// Note on scope: this is a SMOKE test, not a full regression suite. It
// verifies the app loads, renders its shell, and that /api/health +
// /api/config/meta return shape-correct responses. Full deploy-flow
// assertions land in a follow-up once the SPA emits stable test IDs.

import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')

const MIHARBOR_PORT = 4101
const MOCK_MIHOMO_PORT = 19999

// Ephemeral data dir under the web workspace so it's cleaned up alongside
// `dist/` during CI artifact handling. We cannot clean the dir between test
// files because Playwright reuses the webServer, so we accept a bit of state
// bleed and rely on each test to make idempotent assertions.
const DATA_DIR = resolve(repoRoot, '.playwright-data')

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false, // one Miharbor server, sequential flows.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  use: {
    baseURL: `http://127.0.0.1:${MIHARBOR_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      // Mock mihomo first — Miharbor's health monitor starts pinging the
      // upstream immediately and we want it to find the mock alive.
      command: `bun run ${resolve(repoRoot, 'e2e/mock-mihomo.ts')}`,
      url: `http://127.0.0.1:${MOCK_MIHOMO_PORT}/mock/ping`,
      env: {
        MOCK_MIHOMO_PORT: String(MOCK_MIHOMO_PORT),
        MOCK_MIHOMO_VERSION: process.env.MOCK_MIHOMO_VERSION || '1.19.23',
      },
      reuseExistingServer: !process.env.CI,
      // Cold-start of bun can exceed 15s on CI runners under contention; bumped to 60s.
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `bun run apps/server/src/index.ts`,
      cwd: repoRoot,
      url: `http://127.0.0.1:${MIHARBOR_PORT}/health`,
      env: {
        MIHARBOR_PORT: String(MIHARBOR_PORT),
        MIHARBOR_TRANSPORT: 'ssh', // uses InMemoryTransport — no FS writes
        MIHARBOR_AUTH_DISABLED: 'true',
        MIHARBOR_DATA_DIR: DATA_DIR,
        MIHARBOR_CONFIG_PATH: `${DATA_DIR}/config.yaml`,
        MIHARBOR_WEB_DIST: resolve(__dirname, 'dist'),
        MIHARBOR_VAULT_KEY: '0011223344556677889900aabbccddee0011223344556677889900aabbccddee',
        MIHARBOR_LOG_LEVEL: 'warn',
        MIHOMO_API_URL: `http://127.0.0.1:${MOCK_MIHOMO_PORT}`,
        MIHOMO_API_SECRET: '',
      },
      reuseExistingServer: !process.env.CI,
      // Cold-start of bun imports (Elysia + ssh2 + yaml + argon2 + ...) can exceed 20s
      // on GitHub Actions runners under contention. Bumped to 60s for stability.
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
