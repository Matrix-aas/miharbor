import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryTransport } from '../../src/transport/in-memory.ts'
import { createVault, SENTINEL_PREFIX } from '../../src/vault/vault.ts'
import { createSnapshotManager } from '../../src/deploy/snapshot.ts'

let dataDir: string
const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
const WG_FIXTURE_SIMPLE = readFileSync('apps/server/tests/fixtures/vault-wg-simple.yaml', 'utf8')
const REAL_LOOKING_KEY = 'kEYA0FWkeJj3fTGt0WlBCQhMErX/u/rt82v+8NLtCEo='

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'miharbor-snapshot-'))
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

async function makeManager(opts: { now?: () => Date } = {}) {
  const transport = new InMemoryTransport({ initialConfig: 'mode: rule\n' })
  const vault = await createVault({ dataDir, vaultKeyEnv: TEST_KEY })
  const mgr = createSnapshotManager({
    transport,
    vault,
    retention: { retentionCount: 50, retentionDays: 30 },
    ...(opts.now ? { now: opts.now } : {}),
  })
  return { transport, vault, mgr }
}

test('createSnapshot masks secrets + writes meta with both sha256 fields', async () => {
  const { transport, mgr } = await makeManager()
  const meta = await mgr.createSnapshot(WG_FIXTURE_SIMPLE, { applied_by: 'user' })
  expect(meta).not.toBeNull()
  expect(meta!.sha256_original).toHaveLength(64)
  expect(meta!.sha256_masked).toHaveLength(64)
  expect(meta!.sha256_original).not.toBe(meta!.sha256_masked)
  expect(meta!.id).toContain(meta!.sha256_masked.slice(0, 8))

  // Verify on-disk `config.yaml` is fully masked.
  const bundle = await transport.readSnapshot(meta!.id)
  expect(bundle['config.yaml']).not.toContain(REAL_LOOKING_KEY)
  expect(bundle['config.yaml']).toContain(SENTINEL_PREFIX)
})

test('INTEGRATION: masked config.yaml never contains raw private-key', async () => {
  // This is the critical security-invariant test: after createSnapshot,
  // absolutely no plaintext secret should survive in the snapshot file.
  const { transport, mgr } = await makeManager()
  const meta = await mgr.createSnapshot(WG_FIXTURE_SIMPLE, { applied_by: 'user' })
  const bundle = await transport.readSnapshot(meta!.id)
  expect(bundle['config.yaml']).not.toContain(REAL_LOOKING_KEY)
  expect(bundle['diff.patch']).not.toContain(REAL_LOOKING_KEY)
})

test('createSnapshot round-trips via unmask', async () => {
  const { mgr, vault } = await makeManager()
  const meta = await mgr.createSnapshot(WG_FIXTURE_SIMPLE, { applied_by: 'user' })
  const { configMasked } = await mgr.getSnapshot(meta!.id)
  // Callers unmask for rollback. We emulate it.
  const { parseDocument } = await import('yaml')
  const doc = parseDocument(configMasked)
  await vault.unmaskDoc(doc)
  expect(doc.toString()).toContain(REAL_LOOKING_KEY)
})

test('createSnapshot diff.patch is unified diff between previous and current masked', async () => {
  const { transport, mgr } = await makeManager()
  await mgr.createSnapshot('mode: rule\nlog-level: info\n', { applied_by: 'user' })
  const second = await mgr.createSnapshot('mode: global\nlog-level: debug\n', {
    applied_by: 'user',
  })
  const bundle = await transport.readSnapshot(second!.id)
  expect(bundle['diff.patch']).toContain('-mode: rule')
  expect(bundle['diff.patch']).toContain('+mode: global')
  expect(second!.diff_summary!.added).toBeGreaterThan(0)
  expect(second!.diff_summary!.removed).toBeGreaterThan(0)
})

test('first snapshot diff.patch is against /dev/null', async () => {
  const { transport, mgr } = await makeManager()
  const meta = await mgr.createSnapshot('mode: rule\n', { applied_by: 'user' })
  const bundle = await transport.readSnapshot(meta!.id)
  expect(bundle['diff.patch']).toContain('/dev/null')
  expect(bundle['diff.patch']).toContain('+mode: rule')
})

test('auto-rollback dedupes when masked content matches previous', async () => {
  const { transport, mgr } = await makeManager()
  await mgr.createSnapshot('mode: rule\n', { applied_by: 'user' })
  const dup = await mgr.createSnapshot('mode: rule\n', { applied_by: 'auto-rollback' })
  expect(dup).toBeNull()
  // Only 1 snapshot persisted.
  expect(await transport.readSnapshotsDir()).toHaveLength(1)
})

test('auto-rollback NOT deduped when content differs', async () => {
  const { transport, mgr } = await makeManager()
  await mgr.createSnapshot('mode: rule\n', { applied_by: 'user' })
  const second = await mgr.createSnapshot('mode: global\n', { applied_by: 'auto-rollback' })
  expect(second).not.toBeNull()
  expect(await transport.readSnapshotsDir()).toHaveLength(2)
})

test('listSnapshots is newest-first', async () => {
  let n = Date.parse('2026-04-16T10:00:00.000Z')
  const clock = () => new Date(n)
  const { mgr } = await makeManager({ now: clock })
  await mgr.createSnapshot('a: 1\n', { applied_by: 'user' })
  n += 60_000
  await mgr.createSnapshot('a: 2\n', { applied_by: 'user' })
  n += 60_000
  await mgr.createSnapshot('a: 3\n', { applied_by: 'user' })
  const list = await mgr.listSnapshots()
  expect(list).toHaveLength(3)
  // Newest first — timestamps strictly decreasing.
  for (let i = 0; i < list.length - 1; i += 1) {
    expect(list[i]!.timestamp >= list[i + 1]!.timestamp).toBe(true)
  }
})

test('applyRetention removes ancient snapshots past both bounds', async () => {
  // Count bound = 1, days = 0 → keep only index 0.
  const { transport, vault } = await makeManager()
  const mgr = createSnapshotManager({
    transport,
    vault,
    retention: { retentionCount: 1, retentionDays: 0 },
  })
  await mgr.createSnapshot('a: 1\n', { applied_by: 'user' })
  await new Promise((r) => setTimeout(r, 5))
  await mgr.createSnapshot('a: 2\n', { applied_by: 'user' })
  await new Promise((r) => setTimeout(r, 5))
  await mgr.createSnapshot('a: 3\n', { applied_by: 'user' })
  const { removed } = await mgr.applyRetention()
  expect(removed.length).toBe(2)
  expect(await mgr.listSnapshots()).toHaveLength(1)
})

test('applyRetention keeps everything within both bounds (real defaults)', async () => {
  const { transport, vault } = await makeManager()
  const mgr = createSnapshotManager({
    transport,
    vault,
    retention: { retentionCount: 50, retentionDays: 30 },
  })
  for (let i = 0; i < 10; i += 1) {
    await mgr.createSnapshot(`a: ${i}\n`, { applied_by: 'user' })
    await new Promise((r) => setTimeout(r, 2))
  }
  const { removed } = await mgr.applyRetention()
  expect(removed).toEqual([])
})

test('applyRetention triggers vault GC — orphaned uuids purged', async () => {
  // Force retention to drop old snapshots, then confirm that WG secrets
  // in them no longer resolve (vault.gc removed them).
  const { transport, vault } = await makeManager()
  const mgr = createSnapshotManager({
    transport,
    vault,
    retention: { retentionCount: 1, retentionDays: 0 },
  })
  await mgr.createSnapshot(WG_FIXTURE_SIMPLE, { applied_by: 'user' })
  await new Promise((r) => setTimeout(r, 5))
  // Second snapshot with same content but different vault entries
  // (every createSnapshot mints fresh uuids — expected).
  await mgr.createSnapshot(WG_FIXTURE_SIMPLE, { applied_by: 'user' })

  // Read back the surviving-after-this-test uuids from the older snapshot.
  const all = await mgr.listSnapshots()
  expect(all).toHaveLength(2)
  const older = all[1]!
  const olderBundle = await transport.readSnapshot(older.id)
  const { parseDocument } = await import('yaml')
  const olderDoc = parseDocument(olderBundle['config.yaml'])
  const olderUuids = (await import('../../src/deploy/snapshot.ts')).extractSentinelUuids(olderDoc)
  expect(olderUuids.length).toBeGreaterThan(0)
  const sampleUuid = olderUuids[0]!
  // Before retention — uuid resolves (it's in the vault).
  expect(await vault.resolve(sampleUuid)).toBe(REAL_LOOKING_KEY)
  // Run retention — older snapshot dies.
  const { removed } = await mgr.applyRetention()
  expect(removed).toContain(older.id)
  // After retention — that uuid is gone.
  expect(await vault.resolve(sampleUuid)).toBeNull()
})

test('createSnapshot rejects unparseable YAML with a clear error', async () => {
  const { mgr } = await makeManager()
  await expect(mgr.createSnapshot('mode: [unclosed\n', { applied_by: 'user' })).rejects.toThrow(
    /YAML failed to parse/,
  )
})

test('meta propagates applied_by / user_ip / user_agent / mihomo_api_version', async () => {
  const { mgr } = await makeManager()
  const meta = await mgr.createSnapshot('mode: rule\n', {
    applied_by: 'rollback',
    user_ip: '192.168.1.55',
    user_agent: 'curl/8',
    mihomo_api_version: '1.19.23',
  })
  expect(meta!.applied_by).toBe('rollback')
  expect(meta!.user_ip).toBe('192.168.1.55')
  expect(meta!.user_agent).toBe('curl/8')
  expect(meta!.mihomo_api_version).toBe('1.19.23')
})

test('snapshot id format matches <ISO8601>-<hash8>', async () => {
  const clock = () => new Date('2026-04-16T10:00:00.000Z')
  const { mgr } = await makeManager({ now: clock })
  const meta = await mgr.createSnapshot('mode: rule\n', { applied_by: 'user' })
  // Colons replaced with `-` for FS safety.
  expect(meta!.id).toStartWith('2026-04-16T10-00-00.000Z-')
  expect(meta!.id).toMatch(/-[0-9a-f]{8}$/)
})
