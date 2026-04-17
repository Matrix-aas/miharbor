// Miharbor e2e smoke — confirms the stack comes up and the SPA loads.
//
// This is intentionally shallow for v0.1: we verify the three things that
// would blow up hardest in production — the server starts, the API responds,
// and the pre-built Vue bundle renders in a real browser. Deep flows (deploy
// pipeline happy-path, rollback) land in a follow-up once we add stable
// `data-testid` attributes to the SPA (tracked as v0.2 / Stage 2 work).
//
// Run locally:
//   bun run --filter miharbor-web build   # one-time: produce dist/
//   bun run e2e

import { test, expect } from '@playwright/test'

test.describe('Miharbor smoke', () => {
  test('server responds to /health', async ({ request }) => {
    const res = await request.get('/health')
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('ok')
  })

  test('API /api/health/ returns a status object', async ({ request }) => {
    const res = await request.get('/api/health/')
    expect(res.status()).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    // `status` is whatever the monitor last observed — could be unknown
    // during the brief startup window, or mihomo-up once the poll lands.
    expect(typeof body.status).toBe('string')
  })

  test('config meta endpoint responds for the seeded in-memory transport', async ({ request }) => {
    const res = await request.get('/api/config/meta')
    // InMemoryTransport starts empty; meta endpoint should still return 200
    // with a best-effort payload (empty sections) rather than 500.
    expect(res.status()).toBeLessThan(500)
  })

  test('SPA shell loads at /', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)
    // Title is set by apps/web/index.html.
    await expect(page).toHaveTitle(/Miharbor/)
    // #app mount point should exist (populated by Vue on hydration).
    await page.waitForSelector('#app', { timeout: 10_000 })
  })

  test('deep links fall back to index.html for the SPA router', async ({ page }) => {
    // Any unknown path under / should serve index.html so Vue Router can
    // resolve it client-side; this guards invariant #6 of the static SPA
    // serving in server-bootstrap.ts.
    const response = await page.goto('/some-unknown-deep-link')
    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle(/Miharbor/)
  })
})
