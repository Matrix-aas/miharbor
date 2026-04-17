// /api/snapshots/* route tests.

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryTransport } from '../../src/transport/in-memory.ts'
import { createVault } from '../../src/vault/vault.ts'
import { createSnapshotManager } from '../../src/deploy/snapshot.ts'
import { snapshotRoutes } from '../../src/routes/snapshots.ts'
import type { DeployContext } from '../../src/deploy/pipeline.ts'
import type { AuditLog } from '../../src/observability/audit-log.ts'

const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
let dataDir: string

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'miharbor-snap-routes-'))
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

async function buildApp() {
  const transport = new InMemoryTransport({ initialConfig: 'mode: rule\n' })
  const vault = await createVault({ dataDir, vaultKeyEnv: TEST_KEY })
  const snapshots = createSnapshotManager({
    transport,
    vault,
    retention: { retentionCount: 50, retentionDays: 30 },
  })
  const audit: AuditLog = { record: async () => {} }
  const deployCtx = (): DeployContext => ({
    transport,
    vault,
    snapshots,
    mihomoApi: {
      getVersion: async () => ({ version: 't', premium: false }),
      reloadConfig: async () => {},
      listProxies: async () => ({}),
      getProxyDelay: async () => ({ delay: 1 }),
      listProviders: async () => ({}),
      refreshProvider: async () => {},
      listRuleProviders: async () => ({}),
      refreshRuleProvider: async () => {},
      listRules: async () => [],
    },
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    audit,
    lockFile: join(dataDir, 'cfg.lock'),
  })
  const app = new Elysia().use(snapshotRoutes({ snapshots, deployCtx }))
  return { app, snapshots, transport }
}

test('GET /api/snapshots returns empty list when none exist', async () => {
  const { app } = await buildApp()
  const r = await app.handle(new Request('http://localhost/api/snapshots/'))
  expect(r.status).toBe(200)
  const body = (await r.json()) as unknown[]
  expect(body).toEqual([])
})

test('GET /api/snapshots returns SnapshotMeta[] newest-first', async () => {
  const { app, snapshots } = await buildApp()
  await snapshots.createSnapshot('a: 1\n', { applied_by: 'user' })
  await new Promise((r) => setTimeout(r, 2))
  await snapshots.createSnapshot('a: 2\n', { applied_by: 'user' })
  const r = await app.handle(new Request('http://localhost/api/snapshots/'))
  const list = (await r.json()) as Array<{ id: string; timestamp: string }>
  expect(list.length).toBe(2)
  expect(list[0]!.timestamp >= list[1]!.timestamp).toBe(true)
})

test('GET /api/snapshots/:id returns meta + masked config', async () => {
  const { app, snapshots } = await buildApp()
  const meta = await snapshots.createSnapshot('mode: rule\n', { applied_by: 'user' })
  const r = await app.handle(new Request(`http://localhost/api/snapshots/${meta!.id}`))
  expect(r.status).toBe(200)
  const body = (await r.json()) as { meta: { id: string }; configMasked: string }
  expect(body.meta.id).toBe(meta!.id)
  expect(body.configMasked).toContain('mode: rule')
})

test('POST /api/snapshots/:id/rollback emits SSE stream of step events', async () => {
  const { app, snapshots, transport } = await buildApp()
  // Seed: current = "mode: rule", snapshot captures that state.
  const snapMeta = await snapshots.createSnapshot('mode: rule\n', { applied_by: 'user' })
  // Mutate live so there's something to roll back from.
  transport.setConfigRaw('mode: global\n')

  const r = await app.handle(
    new Request(`http://localhost/api/snapshots/${snapMeta!.id}/rollback`, { method: 'POST' }),
  )
  expect(r.status).toBe(200)
  expect(r.headers.get('content-type')).toContain('text/event-stream')

  // Drain the stream. We limit reading so we don't hang on empty.
  const text = await r.text()
  expect(text).toContain('event: step')
  expect(text).toContain('event: done')
})
