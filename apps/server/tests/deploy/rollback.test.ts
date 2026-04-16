// Rollback tests — verify that `applyRollback` unmasks the chosen snapshot
// and re-applies it through the deploy pipeline, creating a new snapshot
// with `applied_by: 'rollback'` (or `'auto-rollback'`) + the original
// secrets land back on the live config.

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryTransport } from '../../src/transport/in-memory.ts'
import { createVault } from '../../src/vault/vault.ts'
import { createSnapshotManager } from '../../src/deploy/snapshot.ts'
import { runPipeline, type DeployContext } from '../../src/deploy/pipeline.ts'
import { applyRollback, RollbackRecursionError } from '../../src/deploy/rollback.ts'
import type { MihomoApi } from '../../src/mihomo/api-client.ts'
import type { AuditLog, AuditRecord } from '../../src/observability/audit-log.ts'

const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
const WG_FIXTURE_SIMPLE = readFileSync('apps/server/tests/fixtures/vault-wg-simple.yaml', 'utf8')
const REAL_LOOKING_KEY = 'kEYA0FWkeJj3fTGt0WlBCQhMErX/u/rt82v+8NLtCEo='

let dataDir: string

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'miharbor-rollback-'))
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

function makeApi(): MihomoApi {
  return {
    getVersion: async () => ({ version: 't', premium: false }),
    reloadConfig: async () => {},
    listProxies: async () => ({}),
    getProxyDelay: async () => ({ delay: 1 }),
    listProviders: async () => ({}),
    refreshProvider: async () => {},
    listRules: async () => [],
  }
}

async function buildCtx(
  initialConfig: string,
): Promise<{ ctx: DeployContext; transport: InMemoryTransport; audits: AuditRecord[] }> {
  const transport = new InMemoryTransport({ initialConfig })
  const vault = await createVault({ dataDir, vaultKeyEnv: TEST_KEY })
  const snapshots = createSnapshotManager({
    transport,
    vault,
    retention: { retentionCount: 50, retentionDays: 30 },
  })
  const audits: AuditRecord[] = []
  const audit: AuditLog = {
    record: async (r) => {
      audits.push(r)
    },
  }
  const ctx: DeployContext = {
    transport,
    vault,
    snapshots,
    mihomoApi: makeApi(),
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    audit,
    lockFile: join(dataDir, 'config.yaml.lock'),
  }
  return { ctx, transport, audits }
}

test('applyRollback restores original secrets onto live config', async () => {
  // Start from a config WITH the real secret.
  const { ctx, transport } = await buildCtx(WG_FIXTURE_SIMPLE)

  // First deploy: draft replaces the private-key with something else.
  const newDraft = WG_FIXTURE_SIMPLE.replace(
    REAL_LOOKING_KEY,
    'AnewKEY0000000000000000000000000000000000000=',
  )
  const firstDeploy = await runPipeline({ draft: newDraft, ctx, appliedBy: 'user' })

  // The snapshot captured the PREVIOUS (original) state.
  const firstSnapshotId = firstDeploy.snapshot_id
  // Now the live config has the new key.
  expect((await transport.readConfig()).content).toContain(
    'AnewKEY0000000000000000000000000000000000000=',
  )

  // Roll back to the snapshot we just created. That snapshot contains the
  // ORIGINAL real key (masked).
  const rolled = await applyRollback({
    snapshotId: firstSnapshotId,
    deployCtx: ctx,
    snapshots: ctx.snapshots,
    vault: ctx.vault,
    logger: ctx.logger,
    auto: false,
  })

  expect(rolled.snapshot_id).toBeTruthy()
  // Live config is back to the original.
  const after = await transport.readConfig()
  expect(after.content).toContain(REAL_LOOKING_KEY)
  expect(after.content).not.toContain('AnewKEY0000000000000000000000000000000000000=')
})

test('auto-rollback depth guard: recursion throws RollbackRecursionError', async () => {
  const { ctx } = await buildCtx(WG_FIXTURE_SIMPLE)
  // Seed a snapshot to roll back to.
  const snap = await ctx.snapshots.createSnapshot(WG_FIXTURE_SIMPLE, { applied_by: 'user' })

  // Fake that we're ALREADY inside an auto-rollback by pre-setting depth.
  ;(ctx as unknown as { _autoRollbackDepth?: number })._autoRollbackDepth = 1

  let thrown: unknown = null
  try {
    await applyRollback({
      snapshotId: snap!.id,
      deployCtx: ctx,
      snapshots: ctx.snapshots,
      vault: ctx.vault,
      logger: ctx.logger,
      auto: true,
    })
  } catch (e) {
    thrown = e
  }
  expect(thrown).toBeInstanceOf(RollbackRecursionError)
})

test('applyRollback (non-auto) does NOT engage the recursion guard', async () => {
  const { ctx } = await buildCtx(WG_FIXTURE_SIMPLE)
  const snap = await ctx.snapshots.createSnapshot(WG_FIXTURE_SIMPLE, { applied_by: 'user' })

  // Manually set the depth — a user-initiated rollback should ignore it.
  ;(ctx as unknown as { _autoRollbackDepth?: number })._autoRollbackDepth = 1

  // Should NOT throw.
  const res = await applyRollback({
    snapshotId: snap!.id,
    deployCtx: ctx,
    snapshots: ctx.snapshots,
    vault: ctx.vault,
    logger: ctx.logger,
    auto: false,
  })
  expect(res.snapshot_id).toBeTruthy()
})

test('auto-rollback audit action is auto-rollback', async () => {
  const { ctx, audits } = await buildCtx(WG_FIXTURE_SIMPLE)
  const snap = await ctx.snapshots.createSnapshot(WG_FIXTURE_SIMPLE, { applied_by: 'user' })
  await applyRollback({
    snapshotId: snap!.id,
    deployCtx: ctx,
    snapshots: ctx.snapshots,
    vault: ctx.vault,
    logger: ctx.logger,
    auto: true,
  })
  const last = audits[audits.length - 1]
  expect(last?.action).toBe('auto-rollback')
})
