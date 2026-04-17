// /api/onboarding/* route tests.
//
// Covers:
//  * GET /status reports needsOnboarding=true when transport read fails.
//  * POST /seed writes a valid config, creates a snapshot, returns 201.
//  * POST /seed refuses when a config already exists (409).

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { runSharedLinters } from 'miharbor-shared'
import { InMemoryTransport } from '../../src/transport/in-memory.ts'
import { createVault } from '../../src/vault/vault.ts'
import { createSnapshotManager } from '../../src/deploy/snapshot.ts'
import { onboardingRoutes } from '../../src/routes/onboarding.ts'
import { canonicalize } from '../../src/config/canonicalize.ts'
import type { Transport } from '../../src/transport/transport.ts'

const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
let dataDir: string

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'miharbor-onboarding-'))
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

async function buildApp(initialConfig = '') {
  const transport = new InMemoryTransport({ initialConfig })
  const vault = await createVault({ dataDir, vaultKeyEnv: TEST_KEY })
  const snapshots = createSnapshotManager({
    transport,
    vault,
    retention: { retentionCount: 50, retentionDays: 30 },
  })
  const app = new Elysia().use(
    onboardingRoutes({
      transport,
      snapshots,
      configPath: '/fake/config.yaml',
      lockFile: join(dataDir, 'cfg.lock'),
    }),
  )
  return { app, transport, snapshots }
}

class FailingReadTransport extends InMemoryTransport {
  readConfig(): Promise<{ content: string; hash: string }> {
    return Promise.reject(new Error('ENOENT — config file missing'))
  }
}

test('GET /api/onboarding/status reports needsOnboarding=false when transport reads succeed', async () => {
  const { app } = await buildApp('mode: rule\n')
  const r = await app.handle(new Request('http://localhost/api/onboarding/status'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as { needsOnboarding: boolean }
  expect(body.needsOnboarding).toBe(false)
})

test('GET /api/onboarding/status reports needsOnboarding=true when read fails', async () => {
  // Build with the failing transport directly (buildApp uses InMemoryTransport).
  const transport = new FailingReadTransport() as unknown as Transport
  const vault = await createVault({ dataDir, vaultKeyEnv: TEST_KEY })
  const snapshots = createSnapshotManager({
    transport,
    vault,
    retention: { retentionCount: 50, retentionDays: 30 },
  })
  const app = new Elysia().use(
    onboardingRoutes({
      transport,
      snapshots,
      configPath: '/fake/config.yaml',
      lockFile: join(dataDir, 'cfg.lock'),
    }),
  )
  const r = await app.handle(new Request('http://localhost/api/onboarding/status'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as { needsOnboarding: boolean }
  expect(body.needsOnboarding).toBe(true)
})

test('POST /api/onboarding/seed writes valid config and creates snapshot', async () => {
  const { app, transport, snapshots } = await buildApp('')
  const r = await app.handle(
    new Request('http://localhost/api/onboarding/seed', { method: 'POST' }),
  )
  expect(r.status).toBe(201)
  const body = (await r.json()) as { success: boolean; path: string }
  expect(body.success).toBe(true)

  const { content } = await transport.readConfig()
  expect(content.length).toBeGreaterThan(0)
  // Canonical + linter-clean.
  expect(canonicalize(content).text).toBe(content)
  expect(runSharedLinters(parseDocument(content))).toEqual([])
  // Secret should have been replaced — 64 hex chars, no placeholder left.
  expect(content).not.toContain('__MIHARBOR_SEED_SECRET__')
  const secretMatch = content.match(/^secret: ([0-9a-f]{64})$/m)
  expect(secretMatch).not.toBeNull()

  // Initial snapshot was recorded.
  const snaps = await snapshots.listSnapshots()
  expect(snaps.length).toBe(1)
  expect(snaps[0]!.applied_by).toBe('user')
})

test('POST /api/onboarding/seed refuses when a config already exists', async () => {
  const { app } = await buildApp('mode: rule\n')
  const r = await app.handle(
    new Request('http://localhost/api/onboarding/seed', { method: 'POST' }),
  )
  expect(r.status).toBe(409)
  const body = (await r.json()) as { code: string }
  expect(body.code).toBe('CONFIG_EXISTS')
})

test('POST /api/onboarding/seed generates a unique secret per call', async () => {
  const { app, transport } = await buildApp('')
  await app.handle(new Request('http://localhost/api/onboarding/seed', { method: 'POST' }))
  const firstContent = (await transport.readConfig()).content

  // Clear and re-seed.
  transport.setConfigRaw('')
  await app.handle(new Request('http://localhost/api/onboarding/seed', { method: 'POST' }))
  const secondContent = (await transport.readConfig()).content

  const firstSecret = firstContent.match(/^secret: ([0-9a-f]{64})$/m)?.[1]
  const secondSecret = secondContent.match(/^secret: ([0-9a-f]{64})$/m)?.[1]
  expect(firstSecret).toBeDefined()
  expect(secondSecret).toBeDefined()
  expect(firstSecret).not.toBe(secondSecret)
})
