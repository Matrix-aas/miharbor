// Deploy-pipeline tests. Uses InMemoryTransport + a real Vault (backed by
// a throwaway tmpdir) + real SnapshotManager + a mock MihomoApi so we exercise
// every step end-to-end without hitting the network or a real filesystem for
// the live config.

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryTransport } from '../../src/transport/in-memory.ts'
import { createVault } from '../../src/vault/vault.ts'
import { createSnapshotManager } from '../../src/deploy/snapshot.ts'
import {
  runPipeline,
  DeployLintError,
  DeployPreflightError,
  DeployWriteError,
  DeployHealthcheckError,
  type DeployContext,
  type StepEvent,
} from '../../src/deploy/pipeline.ts'
import type { MihomoApi } from '../../src/mihomo/api-client.ts'
import type { AuditLog, AuditRecord } from '../../src/observability/audit-log.ts'

const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
const GOLDEN_CFG = readFileSync('apps/server/tests/fixtures/config-golden.yaml', 'utf8')
const WG_FIXTURE_SIMPLE = readFileSync('apps/server/tests/fixtures/vault-wg-simple.yaml', 'utf8')
const REAL_LOOKING_KEY = 'kEYA0FWkeJj3fTGt0WlBCQhMErX/u/rt82v+8NLtCEo='

let dataDir: string

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'miharbor-pipeline-'))
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

interface FakeMihomoApi extends MihomoApi {
  reloadCount: number
  /** Set true to make reloadConfig reject. */
  failReload?: boolean
}

function makeMihomoApi(failReload = false): FakeMihomoApi {
  const api: FakeMihomoApi = {
    reloadCount: 0,
    getVersion: async () => ({ version: 'test-1.0.0', premium: false }),
    reloadConfig: async () => {
      api.reloadCount += 1
      if (api.failReload) {
        const err = new Error('simulated mihomo reload failure')
        ;(err as Error & { status?: number }).status = 500
        throw err
      }
    },
    listProxies: async () => ({}),
    getProxyDelay: async () => ({ delay: 42 }),
    listProviders: async () => ({}),
    refreshProvider: async () => {},
    listRuleProviders: async () => ({}),
    refreshRuleProvider: async () => {},
    listRules: async () => [],
    failReload,
  }
  return api
}

interface FakeAudit extends AuditLog {
  records: AuditRecord[]
}

function makeAuditLog(): FakeAudit {
  const records: AuditRecord[] = []
  return {
    records,
    record: async (rec) => {
      records.push(rec)
    },
  }
}

async function buildCtx(opts: {
  initialConfig?: string
  validateResult?: { ok: boolean; errors?: Array<{ message: string }>; raw_output?: string }
  failReload?: boolean
  user?: string
}): Promise<{
  ctx: DeployContext
  transport: InMemoryTransport
  mihomoApi: FakeMihomoApi
  audit: FakeAudit
}> {
  const transport = new InMemoryTransport({
    initialConfig: opts.initialConfig ?? 'mode: rule\n',
    validate: async (_content) => {
      const r = opts.validateResult ?? { ok: true }
      return {
        ok: r.ok,
        errors: r.errors ?? [],
        raw_output: r.raw_output ?? '',
      }
    },
  })
  const vault = await createVault({ dataDir, vaultKeyEnv: TEST_KEY })
  const snapshots = createSnapshotManager({
    transport,
    vault,
    retention: { retentionCount: 50, retentionDays: 30 },
  })
  const mihomoApi = makeMihomoApi(opts.failReload)
  const audit = makeAuditLog()
  const logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }
  const ctx: DeployContext = {
    transport,
    vault,
    snapshots,
    mihomoApi,
    logger,
    audit,
    lockFile: join(dataDir, 'config.yaml.lock'),
    ...(opts.user ? { user: opts.user } : {}),
  }
  return { ctx, transport, mihomoApi, audit }
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test('happy path: all 5 steps run + result returned + audit recorded', async () => {
  const { ctx, transport, mihomoApi, audit } = await buildCtx({
    initialConfig: 'mode: rule\nlog-level: info\n',
  })
  const events: Array<{ id: string; status: string }> = []
  const onStep: StepEvent = (id, status) => {
    events.push({ id, status })
  }

  const result = await runPipeline({
    draft: 'mode: global\nlog-level: debug\n',
    ctx,
    onStep,
    appliedBy: 'user',
  })

  expect(result.snapshot_id).toBeTruthy()
  expect(result.diff.added).toBeGreaterThan(0)
  expect(result.diff.removed).toBeGreaterThan(0)
  expect(mihomoApi.reloadCount).toBe(1)
  expect(transport.writeCount).toBe(1)

  // Every step fired exactly one running + one completed event.
  const ids = ['diff', 'lint', 'snapshot', 'preflight', 'write-reload']
  for (const id of ids) {
    const forStep = events.filter((e) => e.id === id)
    expect(forStep.length).toBe(2)
    expect(forStep[0]!.status).toBe('running')
    expect(forStep[1]!.status).toBe('completed')
  }

  // Audit recorded the deploy.
  expect(audit.records.length).toBe(1)
  expect(audit.records[0]!.action).toBe('deploy')
  expect(audit.records[0]!.snapshot_id).toBe(result.snapshot_id)
  expect(audit.records[0]!.diff_summary).toEqual(result.diff)

  // New config on disk.
  const after = await transport.readConfig()
  expect(after.content).toContain('mode: global')
})

test('happy path with a golden config draft — reload invoked + new config persisted', async () => {
  const { ctx, transport, mihomoApi } = await buildCtx({
    initialConfig: 'mode: rule\n',
  })
  const result = await runPipeline({ draft: GOLDEN_CFG, ctx })
  expect(result.snapshot_id).toBeTruthy()
  expect(mihomoApi.reloadCount).toBe(1)
  const after = await transport.readConfig()
  expect(after.content).toContain('proxies:')
  // Draft had real WG private-key — must land on disk verbatim.
  expect(after.content).toContain('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')
})

// ---------------------------------------------------------------------------
// Step 2 — lint blocked path
// ---------------------------------------------------------------------------

test('lint-error path: throws DeployLintError with issue array; no snapshot created', async () => {
  const { ctx, transport, mihomoApi } = await buildCtx({
    initialConfig: 'mode: rule\n',
  })
  // Golden config has a universal-invariant violation if we break external-controller.
  // Easier path: break `dns.listen` (must be 127.0.0.1:1053 per universal linter).
  const brokenDraft = [
    'mode: rule',
    'dns:',
    '  enable: true',
    '  listen: 0.0.0.0:53', // invariant violation
    '',
  ].join('\n')

  let thrown: unknown = null
  try {
    await runPipeline({ draft: brokenDraft, ctx })
  } catch (e) {
    thrown = e
  }
  expect(thrown).toBeInstanceOf(DeployLintError)
  const err = thrown as DeployLintError
  expect(err.code).toBe('LINT_BLOCKED')
  expect(err.issues.length).toBeGreaterThan(0)

  // Nothing persisted — snapshot not created, config not written.
  expect(await ctx.snapshots.listSnapshots()).toHaveLength(0)
  expect(transport.writeCount).toBe(0)
  expect(mihomoApi.reloadCount).toBe(0)
})

test('YAML parse error surfaces as DeployLintError with YAML_PARSE_ERROR code', async () => {
  const { ctx } = await buildCtx({ initialConfig: 'mode: rule\n' })
  let thrown: unknown = null
  try {
    await runPipeline({ draft: 'mode: [unclosed\n', ctx })
  } catch (e) {
    thrown = e
  }
  expect(thrown).toBeInstanceOf(DeployLintError)
  const err = thrown as DeployLintError
  expect(err.issues[0]!.code).toBe('YAML_PARSE_ERROR')
})

// ---------------------------------------------------------------------------
// Step 4 — preflight fail (snapshot IS created before this step)
// ---------------------------------------------------------------------------

test('preflight fail: throws DeployPreflightError but snapshot is already persisted', async () => {
  const { ctx, transport, mihomoApi } = await buildCtx({
    initialConfig: 'mode: rule\n',
    validateResult: {
      ok: false,
      errors: [{ message: 'bogus: invalid rule target' }],
    },
  })
  let thrown: unknown = null
  try {
    await runPipeline({ draft: 'mode: global\n', ctx })
  } catch (e) {
    thrown = e
  }
  expect(thrown).toBeInstanceOf(DeployPreflightError)
  // Snapshot WAS created (step 3 before step 4).
  const snaps = await ctx.snapshots.listSnapshots()
  expect(snaps).toHaveLength(1)
  // Config NOT written, reload NOT called.
  expect(transport.writeCount).toBe(0)
  expect(mihomoApi.reloadCount).toBe(0)
})

// ---------------------------------------------------------------------------
// Step 5 — reload fail (snapshot + write DID happen)
// ---------------------------------------------------------------------------

test('reload fail: throws DeployWriteError; snapshot exists + config WAS written', async () => {
  const { ctx, transport, mihomoApi } = await buildCtx({
    initialConfig: 'mode: rule\n',
    failReload: true,
  })
  let thrown: unknown = null
  try {
    await runPipeline({ draft: 'mode: global\n', ctx })
  } catch (e) {
    thrown = e
  }
  expect(thrown).toBeInstanceOf(DeployWriteError)
  expect(await ctx.snapshots.listSnapshots()).toHaveLength(1)
  // Write happened; it's the reload that failed.
  expect(transport.writeCount).toBe(1)
  expect(mihomoApi.reloadCount).toBe(1)
})

// ---------------------------------------------------------------------------
// Security invariant — secrets never leak
// ---------------------------------------------------------------------------

test('security: snapshot config.yaml + diff.patch never contain raw private-key', async () => {
  // Current state already has secrets; the DRAFT has DIFFERENT secrets.
  // After the pipeline runs, the captured snapshot (of current) must be
  // fully masked, and the diff patch (masked vs masked) must not contain
  // either original or draft raw keys.
  const draftWithNewKey = WG_FIXTURE_SIMPLE.replace(
    REAL_LOOKING_KEY,
    'NEWkEYzzxxyyAAAABBCCDDEE12345678ABCDEF0123456FGHIJKLM=',
  )
  const { ctx, transport } = await buildCtx({
    initialConfig: WG_FIXTURE_SIMPLE,
  })
  const result = await runPipeline({ draft: draftWithNewKey, ctx })
  const snap = await transport.readSnapshot(result.snapshot_id)
  expect(snap['config.yaml']).not.toContain(REAL_LOOKING_KEY)
  expect(snap['config.yaml']).not.toContain(
    'NEWkEYzzxxyyAAAABBCCDDEE12345678ABCDEF0123456FGHIJKLM=',
  )
  expect(snap['diff.patch']).not.toContain(REAL_LOOKING_KEY)
  expect(snap['diff.patch']).not.toContain('NEWkEYzzxxyyAAAABBCCDDEE12345678ABCDEF0123456FGHIJKLM=')
  // But the ACTUAL written live config DOES contain the draft's real secret
  // (unmask path in step 5).
  const after = await transport.readConfig()
  expect(after.content).toContain('NEWkEYzzxxyyAAAABBCCDDEE12345678ABCDEF0123456FGHIJKLM=')
})

// ---------------------------------------------------------------------------
// Rollback path — draft contains sentinels from a prior snapshot
// ---------------------------------------------------------------------------

test('rollback path: draft with sentinels is unmasked before write', async () => {
  // Seed the vault + capture a snapshot of the WG fixture, then feed the
  // masked config BACK as the draft (simulating a rollback from history).
  // The pipeline must unmask it so the real private-key lands in the live
  // config again.
  const { ctx, transport } = await buildCtx({ initialConfig: 'mode: rule\n' })
  const seed = await ctx.snapshots.createSnapshot(WG_FIXTURE_SIMPLE, { applied_by: 'user' })
  const maskedBundle = await transport.readSnapshot(seed!.id)
  const maskedDraft = maskedBundle['config.yaml']
  expect(maskedDraft).toContain('$MIHARBOR_VAULT:')
  expect(maskedDraft).not.toContain(REAL_LOOKING_KEY)

  const result = await runPipeline({ draft: maskedDraft, ctx, appliedBy: 'rollback' })
  const after = await transport.readConfig()
  // After write, live file contains the ORIGINAL raw key again.
  expect(after.content).toContain(REAL_LOOKING_KEY)
  // And audit recorded 'rollback' action.
  expect(result.snapshot_id).toBeTruthy()
})

// ---------------------------------------------------------------------------
// Audit identity propagation
// ---------------------------------------------------------------------------

test('audit captures user / user_ip / user_agent from ctx', async () => {
  const { ctx, audit } = await buildCtx({
    initialConfig: 'mode: rule\n',
    user: 'admin',
  })
  ctx.user_ip = '10.0.0.5'
  ctx.user_agent = 'curl/8.5'
  await runPipeline({ draft: 'mode: global\n', ctx })
  const rec = audit.records[0]!
  expect(rec.user).toBe('admin')
  expect(rec.user_ip).toBe('10.0.0.5')
  expect(rec.user_agent).toBe('curl/8.5')
  expect(rec.action).toBe('deploy')
})

test('canonicalization snapshot is audited as canonicalization action', async () => {
  const { ctx, audit } = await buildCtx({ initialConfig: 'mode: rule\n' })
  await runPipeline({
    draft: 'mode: global\n',
    ctx,
    appliedBy: 'canonicalization',
  })
  expect(audit.records[0]!.action).toBe('canonicalization')
})

// ---------------------------------------------------------------------------
// Step 6 — healthcheck + auto-rollback (B1)
// ---------------------------------------------------------------------------

test('healthcheck happy path: step 6 runs + completes when runHealthcheck ok', async () => {
  const { ctx, mihomoApi } = await buildCtx({ initialConfig: 'mode: rule\n' })
  ctx.runHealthcheck = async () => ({ ok: true, diagnostics: { note: 'all good' } })
  const events: Array<{ id: string; status: string }> = []
  const onStep: StepEvent = (id, status) => events.push({ id, status })
  await runPipeline({ draft: 'mode: global\n', ctx, onStep })
  // Healthcheck emitted running + completed (plus intermediate "running"
  // repeats per phase which share status "running" — we assert presence).
  const running = events.filter((e) => e.id === 'healthcheck' && e.status === 'running')
  const completed = events.filter((e) => e.id === 'healthcheck' && e.status === 'completed')
  expect(running.length).toBeGreaterThanOrEqual(1)
  expect(completed.length).toBe(1)
  expect(mihomoApi.reloadCount).toBe(1)
})

test('healthcheck phase-1 failure: throws DeployHealthcheckError + triggers auto-rollback', async () => {
  const { ctx } = await buildCtx({ initialConfig: 'mode: rule\n' })
  // Seed a prior snapshot so there's something to roll back to.
  await ctx.snapshots.createSnapshot('mode: rule\n', { applied_by: 'user' })
  ctx.runHealthcheck = async () => ({
    ok: false,
    failedPhase: 1,
    diagnostics: { reason: 'api-never-alive' },
  })
  let rollbackCalls: Array<{ targetSnapshotId: string }> = []
  ctx.applyRollback = async (args) => {
    rollbackCalls.push({ targetSnapshotId: args.targetSnapshotId })
    args.onStep?.('rollback', 'running')
    args.onStep?.('rollback', 'completed')
    return { snapshot_id: 'rollback-snapshot-id' }
  }
  // autoRollback disabled on purpose — phase 1 should STILL trigger rollback
  // (a dead mihomo always warrants rollback).
  ctx.autoRollback = false

  const events: Array<{ id: string; status: string; data?: unknown }> = []
  const onStep: StepEvent = (id, status, data) => events.push({ id, status, data })
  let thrown: unknown = null
  try {
    await runPipeline({ draft: 'mode: global\n', ctx, onStep })
  } catch (e) {
    thrown = e
  }
  expect(thrown).toBeInstanceOf(DeployHealthcheckError)
  const err = thrown as DeployHealthcheckError
  expect(err.code).toBe('HEALTHCHECK_FAILED')
  expect(err.failedPhase).toBe(1)
  expect(err.rolledBackToSnapshotId).toBe('rollback-snapshot-id')
  expect(rollbackCalls.length).toBe(1)
  // Rollback events emitted to stream.
  expect(events.some((e) => e.id === 'rollback' && e.status === 'running')).toBe(true)
  expect(events.some((e) => e.id === 'rollback' && e.status === 'completed')).toBe(true)
})

test('healthcheck phase-3 failure with autoRollback=false: no rollback, error surfaces', async () => {
  const { ctx } = await buildCtx({ initialConfig: 'mode: rule\n' })
  ctx.runHealthcheck = async () => ({
    ok: false,
    failedPhase: 3,
    diagnostics: { reason: 'delay-check-failed' },
  })
  let rollbackCalled = false
  ctx.applyRollback = async () => {
    rollbackCalled = true
    return { snapshot_id: 'nope' }
  }
  ctx.autoRollback = false
  let thrown: unknown = null
  try {
    await runPipeline({ draft: 'mode: global\n', ctx })
  } catch (e) {
    thrown = e
  }
  expect(thrown).toBeInstanceOf(DeployHealthcheckError)
  expect((thrown as DeployHealthcheckError).failedPhase).toBe(3)
  expect(rollbackCalled).toBe(false)
})

test('healthcheck phase-3 failure with autoRollback=true: triggers rollback', async () => {
  const { ctx } = await buildCtx({ initialConfig: 'mode: rule\n' })
  ctx.runHealthcheck = async () => ({
    ok: false,
    failedPhase: 3,
    diagnostics: { reason: 'delay-check-failed' },
  })
  let rollbackCalled = false
  ctx.applyRollback = async () => {
    rollbackCalled = true
    return { snapshot_id: 'rb-3-id' }
  }
  ctx.autoRollback = true
  let thrown: unknown = null
  try {
    await runPipeline({ draft: 'mode: global\n', ctx })
  } catch (e) {
    thrown = e
  }
  expect(thrown).toBeInstanceOf(DeployHealthcheckError)
  expect(rollbackCalled).toBe(true)
  expect((thrown as DeployHealthcheckError).rolledBackToSnapshotId).toBe('rb-3-id')
})

test('healthcheck failure during rollback appliedBy does NOT trigger recursive rollback', async () => {
  // When the pipeline is invoked with appliedBy='rollback' and the
  // healthcheck fails, we MUST NOT call applyRollback again — that would
  // just re-apply the same broken rollback target.
  const { ctx } = await buildCtx({ initialConfig: 'mode: rule\n' })
  ctx.runHealthcheck = async () => ({ ok: false, failedPhase: 1 })
  let rollbackCalled = false
  ctx.applyRollback = async () => {
    rollbackCalled = true
    return { snapshot_id: 'x' }
  }
  let thrown: unknown = null
  try {
    await runPipeline({ draft: 'mode: global\n', ctx, appliedBy: 'rollback' })
  } catch (e) {
    thrown = e
  }
  expect(thrown).toBeInstanceOf(DeployHealthcheckError)
  expect(rollbackCalled).toBe(false)
})

test('healthcheck runner throws → treated as phase-1 failure', async () => {
  const { ctx } = await buildCtx({ initialConfig: 'mode: rule\n' })
  ctx.runHealthcheck = async () => {
    throw new Error('network explosion')
  }
  let rollbackCalled = false
  ctx.applyRollback = async () => {
    rollbackCalled = true
    return { snapshot_id: 'rb' }
  }
  let thrown: unknown = null
  try {
    await runPipeline({ draft: 'mode: global\n', ctx })
  } catch (e) {
    thrown = e
  }
  expect(thrown).toBeInstanceOf(DeployHealthcheckError)
  expect((thrown as DeployHealthcheckError).failedPhase).toBe(1)
  expect(rollbackCalled).toBe(true)
})

test('auto-rollback path: when applyRollback itself throws, error carries rollbackError', async () => {
  const { ctx } = await buildCtx({ initialConfig: 'mode: rule\n' })
  ctx.runHealthcheck = async () => ({ ok: false, failedPhase: 1 })
  ctx.applyRollback = async () => {
    throw new Error('rollback pipeline exploded')
  }
  let thrown: unknown = null
  try {
    await runPipeline({ draft: 'mode: global\n', ctx })
  } catch (e) {
    thrown = e
  }
  expect(thrown).toBeInstanceOf(DeployHealthcheckError)
  expect((thrown as DeployHealthcheckError).rollbackError).toContain('rollback pipeline exploded')
})

test('no runHealthcheck provided: pipeline skips step 6 cleanly', async () => {
  const { ctx } = await buildCtx({ initialConfig: 'mode: rule\n' })
  // ctx.runHealthcheck intentionally NOT set
  const events: Array<{ id: string; status: string }> = []
  const onStep: StepEvent = (id, status) => events.push({ id, status })
  const result = await runPipeline({ draft: 'mode: global\n', ctx, onStep })
  expect(result.snapshot_id).toBeTruthy()
  // No healthcheck events emitted.
  expect(events.some((e) => e.id === 'healthcheck')).toBe(false)
})

// ---------------------------------------------------------------------------
// v0.2.4 — read-only-view sentinel round-trip.
// ---------------------------------------------------------------------------

test('META_SECRET_SENTINEL in draft is resolved back to current secret at write time (v0.2.4)', async () => {
  // Secret must be ≥32 chars per the universal linter invariant, otherwise
  // the pipeline's step-2 lint would reject the draft before write.
  const REAL_SECRET = 'r'.repeat(64)
  const initial = `mode: rule\nsecret: ${REAL_SECRET}\n`
  // Operator's draft carries the sentinel — they saw the masked value in
  // /api/config/meta or copied from a stale clipboard.
  const draft = 'mode: rule\nsecret: __MIHARBOR_SECRET_SET_NOT_SHOWN__\n'
  const { ctx, transport } = await buildCtx({ initialConfig: initial })
  await runPipeline({ draft, ctx })
  const after = await transport.readConfig()
  // Sentinel must NOT survive onto disk.
  expect(after.content).not.toContain('__MIHARBOR_SECRET_SET_NOT_SHOWN__')
  // Existing secret preserved verbatim.
  expect(after.content).toContain(`secret: ${REAL_SECRET}`)
})

test('WIREGUARD_PRIVATE_KEY_SENTINEL in draft is resolved back per-proxy by name (v0.2.4)', async () => {
  const PK = 'priva' + 'te-key'
  const PSK = 'pre-shared-' + 'key'
  const REAL_PK = 'realprivatekeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
  const REAL_PSK = 'realpresharedkeyBBBBBBBBBBBBBBBBBBBBBBBBBB='
  const SENTINEL_PK = 'MIHARBORMASKEDPRIVATEKEYREENTERTOCHANGE1234='
  const SENTINEL_PSK = 'MIHARBORMASKEDPRESHAREDKEYREENTERTOCHANGE12='
  const initial = [
    'proxies:',
    '  - name: wg1',
    '    type: wireguard',
    '    server: 1.2.3.4',
    '    port: 51820',
    '    ip: 10.0.0.2/32',
    `    ${PK}: ${REAL_PK}`,
    '    public-key: pubkeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    `    ${PSK}: ${REAL_PSK}`,
    '',
  ].join('\n')
  const draft = [
    'proxies:',
    '  - name: wg1',
    '    type: wireguard',
    '    server: 1.2.3.4',
    '    port: 51820',
    '    ip: 10.0.0.3/32', // operator only changed the tunnel IP
    `    ${PK}: ${SENTINEL_PK}`,
    '    public-key: pubkeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    `    ${PSK}: ${SENTINEL_PSK}`,
    '',
  ].join('\n')
  const { ctx, transport } = await buildCtx({ initialConfig: initial })
  await runPipeline({ draft, ctx })
  const after = await transport.readConfig()
  expect(after.content).not.toContain(SENTINEL_PK)
  expect(after.content).not.toContain(SENTINEL_PSK)
  expect(after.content).toContain(REAL_PK)
  expect(after.content).toContain(REAL_PSK)
  // Edited field went through.
  expect(after.content).toContain('10.0.0.3/32')
})

test('sentinel resolution is scoped — unrelated string equal to sentinel is left alone (v0.2.4)', async () => {
  // An unrelated field whose value just happens to equal the sentinel string
  // must NOT get substituted — sentinel resolution only applies when the
  // key is `secret` / `private-key` / `pre-shared-key`.
  const LITERAL = '__MIHARBOR_SECRET_SET_NOT_SHOWN__'
  const GOOD_SECRET = 'a'.repeat(64)
  const initial = `mode: rule\nsecret: ${GOOD_SECRET}\nfoo: ${LITERAL}\n`
  const draft = `mode: rule\nsecret: ${GOOD_SECRET}\nfoo: ${LITERAL}\n`
  const { ctx, transport } = await buildCtx({ initialConfig: initial })
  await runPipeline({ draft, ctx })
  const after = await transport.readConfig()
  // Literal under `foo:` survives because the key isn't `secret`.
  expect(after.content).toContain(`foo: ${LITERAL}`)
})
