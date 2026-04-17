// Deploy pipeline — the serial 5-step flow that turns an operator's draft
// YAML into a live mihomo configuration. Step 6 (healthcheck + auto-rollback)
// lands in Task 16 and is wired via the optional `runHealthcheck` hook on
// `DeployContext` so this module stays single-responsibility.
//
// Step sequence (spec §5 / plan Task 15 — DO NOT REORDER):
//   1. diff       — unified diff of masked current vs masked draft
//   2. lint       — `runSharedLinters(draftDoc)`; errors throw `DeployLintError`
//   3. snapshot   — SnapshotManager of the CURRENT raw config (not the draft)
//   4. preflight  — transport.runMihomoValidate(draftMasked) (MVP: shared-only)
//   5. write+reload — unmask-if-needed → verifyAndWrite under flock → mihomo.reloadConfig
//
// Every step emits a pair of `onStep(stepId, 'running')` / `'completed'|'failed'`
// events so the UI's SSE stream can render a live stepper. Throws are fatal
// (snapshot rolls back nothing — the previous snapshot stays on disk, which is
// what rollback relies on).
//
// Security invariants (covered by tests):
//   - Masked draft is what goes into the diff — real secrets never hit disk.
//   - Snapshot is taken of CURRENT config before any write, so even if
//     unmask/write fails the operator can roll back to the pre-deploy state.
//   - Unmask is done on a SECOND `parseDocument(draft)` pass so the masked
//     copy (used for diff/preflight) stays untouched.

import { parseDocument, type Document } from 'yaml'
import { runSharedLinters } from 'miharbor-shared'
import type { Issue } from 'miharbor-shared'
import type { AuditLog } from '../observability/audit-log.ts'
import type { Logger } from '../observability/logger.ts'
import type { SnapshotManager, CreateSnapshotMeta } from './snapshot.ts'
import type { SnapshotMeta, Transport, ValidationResult } from '../transport/transport.ts'
import type { Vault } from '../vault/vault.ts'
import type { MihomoApi } from '../mihomo/api-client.ts'
import { DUMP_OPTS } from '../config/canonicalize.ts'
import { unifiedDiff } from './diff.ts'
import type { HealthcheckOptions, HealthcheckResult } from './healthcheck.ts'

/** Possible step IDs for `onStep` callbacks. UI renders a stepper keyed on
 *  these. `healthcheck` is step 6 (post-reload) and `rollback` is emitted
 *  only when auto-rollback engages after a failed healthcheck. */
export type StepId =
  | 'diff'
  | 'lint'
  | 'snapshot'
  | 'preflight'
  | 'write-reload'
  | 'healthcheck'
  | 'rollback'

export type StepStatus = 'running' | 'completed' | 'failed'

export type StepEvent = (stepId: StepId, status: StepStatus, data?: Record<string, unknown>) => void

/** Bundle of resources the pipeline needs. Kept as a single param so callers
 *  don't pass 7 positional args and so tests can construct a minimal context
 *  with in-memory doubles. */
export interface DeployContext {
  transport: Transport
  vault: Vault
  snapshots: SnapshotManager
  mihomoApi: MihomoApi
  logger: Pick<Logger, 'info' | 'warn' | 'debug' | 'error'>
  audit: AuditLog
  /** Lock file path passed through to `transport.writeConfig`. LocalFs
   *  honours this via `proper-lockfile`; InMemory ignores it. */
  lockFile: string
  /** Optional — if provided, pipeline runs phase-1..4 healthcheck after
   *  step 5 (`write-reload`). Wired from `server-bootstrap.deployCtx()`.
   *  `opts.onPhase` is forwarded so UI can render per-phase progress on the
   *  healthcheck step. */
  runHealthcheck?: (mihomoApi: MihomoApi, opts?: HealthcheckOptions) => Promise<HealthcheckResult>
  /**
   * Apply a rollback by re-running the pipeline against a previous snapshot.
   * Called by the auto-rollback branch after a failed healthcheck (phase 1
   * always, phase 3 when `autoRollback === true`). Wired in server-bootstrap
   * from `deploy/rollback.ts::applyRollback`.
   */
  applyRollback?: (args: {
    targetSnapshotId: string
    onStep?: StepEvent
  }) => Promise<{ snapshot_id: string }>
  /** Mirrors `MIHARBOR_AUTO_ROLLBACK`. When `true`, a healthcheck failure
   *  in phase 3 also triggers `applyRollback`. Phase 1 failure always
   *  triggers rollback regardless of this flag (a dead mihomo is always
   *  worse than a rolled-back config). */
  autoRollback?: boolean
  /** Identity fields for audit + snapshot meta. */
  user?: string
  user_ip?: string
  user_agent?: string
}

export interface RunPipelineOptions {
  /** The operator's draft YAML. May contain sentinels (e.g. rollback from
   *  a previous snapshot) or raw secrets (first deploy / UI edit). */
  draft: string
  ctx: DeployContext
  /** Emit step lifecycle events for UI streaming. Default: no-op. */
  onStep?: StepEvent
  /** Provenance for the snapshot of the *current* config captured at step 3.
   *  Default `'user'`. `'canonicalization'` / `'auto-rollback'` passed by
   *  specific callers. */
  appliedBy?: CreateSnapshotMeta['applied_by']
}

export interface RunPipelineResult {
  /** The newly-created snapshot of the pre-deploy state (never null in a
   *  successful pipeline run — step 3 always creates a snapshot). */
  snapshot_id: string
  /** Diff summary from step 1. */
  diff: { added: number; removed: number }
  /** Issues from step 2 (warnings only — errors throw). */
  warnings: Issue[]
}

/** Thrown by step 2 when the shared linter returns any `error`-level issues. */
export class DeployLintError extends Error {
  public readonly code = 'LINT_BLOCKED'
  public readonly issues: Issue[]
  constructor(issues: Issue[]) {
    super(`deploy: shared linter reported ${issues.length} blocking issue(s)`)
    this.name = 'DeployLintError'
    this.issues = issues
  }
}

/** Thrown by step 4 when mihomo-side preflight validation rejects the draft. */
export class DeployPreflightError extends Error {
  public readonly code = 'PREFLIGHT_FAILED'
  public readonly validation: ValidationResult
  constructor(validation: ValidationResult) {
    super(`deploy: preflight validation failed (${validation.errors.length} error(s))`)
    this.name = 'DeployPreflightError'
    this.validation = validation
  }
}

/** Thrown by step 5 when the write or reload fails. */
export class DeployWriteError extends Error {
  public readonly code = 'WRITE_RELOAD_FAILED'
  public readonly cause: Error
  constructor(msg: string, cause: Error) {
    super(msg)
    this.name = 'DeployWriteError'
    this.cause = cause
  }
}

/** Thrown by step 6 when the post-deploy healthcheck reports an
 *  unrecoverable failure. Phase 1 always fails the deploy; phase 3 fails
 *  only when `autoRollback` is enabled, in which case both the rollback
 *  attempt and its outcome are reported via `onStep('rollback', ...)`. */
export class DeployHealthcheckError extends Error {
  public readonly code = 'HEALTHCHECK_FAILED'
  public readonly failedPhase?: 1 | 2 | 3
  public readonly diagnostics?: Record<string, unknown>
  /** Set when auto-rollback was triggered; contains the new snapshot id
   *  from the rollback pipeline run if it succeeded. */
  public readonly rolledBackToSnapshotId?: string
  /** Set when auto-rollback was attempted but itself failed. */
  public readonly rollbackError?: string
  constructor(init: {
    failedPhase?: 1 | 2 | 3
    diagnostics?: Record<string, unknown>
    rolledBackToSnapshotId?: string
    rollbackError?: string
  }) {
    const suffix =
      init.rollbackError !== undefined
        ? ` (auto-rollback failed: ${init.rollbackError})`
        : init.rolledBackToSnapshotId
          ? ` (rolled back to ${init.rolledBackToSnapshotId})`
          : ''
    super(
      `deploy: post-reload healthcheck failed${
        init.failedPhase ? ` in phase ${init.failedPhase}` : ''
      }${suffix}`,
    )
    this.name = 'DeployHealthcheckError'
    if (init.failedPhase !== undefined) this.failedPhase = init.failedPhase
    if (init.diagnostics !== undefined) this.diagnostics = init.diagnostics
    if (init.rolledBackToSnapshotId !== undefined) {
      this.rolledBackToSnapshotId = init.rolledBackToSnapshotId
    }
    if (init.rollbackError !== undefined) this.rollbackError = init.rollbackError
  }
}

const NOOP_STEP: StepEvent = () => {}

/** Serialize a Document with the canonical options. Centralised so every step
 *  agrees on whitespace and won't produce spurious diffs. */
function serialize(doc: Document): string {
  return doc.toString(DUMP_OPTS)
}

/** Collect the set of `error`-level issues from a flat Issue[]. */
function errorIssues(issues: Issue[]): Issue[] {
  return issues.filter((i) => i.level === 'error')
}

/** Collect non-error issues (warnings + info). */
function nonErrorIssues(issues: Issue[]): Issue[] {
  return issues.filter((i) => i.level !== 'error')
}

/**
 * Run the full deploy pipeline. Throws on the first step that fails; the
 * caller is responsible for converting thrown errors into UI error states.
 *
 * Contract:
 *   - Returns `{ snapshot_id, diff, warnings }` on success (all 5 steps done).
 *   - Throws `DeployLintError` on step 2 failure (no snapshot yet).
 *   - Throws `DeployPreflightError` on step 4 failure (snapshot IS created).
 *   - Throws `DeployWriteError` on step 5 failure (snapshot IS created; caller
 *     can use it to roll back by reapplying the previous snapshot).
 */
export async function runPipeline(opts: RunPipelineOptions): Promise<RunPipelineResult> {
  const { ctx, draft } = opts
  const appliedBy: CreateSnapshotMeta['applied_by'] = opts.appliedBy ?? 'user'
  const onStep = opts.onStep ?? NOOP_STEP

  // Read current state up front — needed for diff + TOCTOU hash.
  const current = await ctx.transport.readConfig()

  // Parse the draft once up front. A YAML parse failure is surfaced as a
  // blocking lint error (step 2) rather than a diff error (step 1) — it's
  // the operator's authoring mistake, not a pipeline/vault problem, so the
  // UI should show it in the lint panel. We short-circuit both step 1 and
  // step 2 in that case to give a single clear failure point.
  const draftParsePreview = parseDocument(draft)
  if (draftParsePreview.errors.length > 0) {
    onStep('diff', 'running')
    onStep('diff', 'failed', { error: draftParsePreview.errors[0]!.message })
    onStep('lint', 'failed', {
      issues: [{ code: 'YAML_PARSE_ERROR', message: draftParsePreview.errors[0]!.message }],
    })
    throw new DeployLintError([
      {
        level: 'error',
        code: 'YAML_PARSE_ERROR',
        path: [],
        params: { message: draftParsePreview.errors[0]!.message },
      },
    ])
  }

  // =========================================================================
  // Step 1: diff (masked current vs masked draft)
  // =========================================================================
  onStep('diff', 'running')
  let draftMaskedText: string
  let diffSummary: { added: number; removed: number }
  try {
    // Mask CURRENT + DRAFT in a scratch vault pass — we only need the
    // masked text, not the vault state. But the vault API is the source of
    // truth for masking, so we reuse it; any uuids minted here will either
    // be consumed by the snapshot (step 3) or GC'd by a later retention pass.
    // Important: we work on *copies* so the draft we unmask in step 5 is a
    // fresh parse from the original string (never affected by step-1 masking).
    const currentDocForMask = parseDocument(current.content)
    await ctx.vault.maskDoc(currentDocForMask)
    const currentMaskedText = serialize(currentDocForMask)

    const draftDocForMask = parseDocument(draft)
    await ctx.vault.maskDoc(draftDocForMask)
    draftMaskedText = serialize(draftDocForMask)

    const r = unifiedDiff(currentMaskedText, draftMaskedText, {
      from: 'current',
      to: 'draft',
    })
    diffSummary = { added: r.added, removed: r.removed }
    onStep('diff', 'completed', { added: r.added, removed: r.removed })
  } catch (e) {
    onStep('diff', 'failed', { error: (e as Error).message })
    throw e
  }

  // =========================================================================
  // Step 2: client lint (shared linters)
  // =========================================================================
  onStep('lint', 'running')
  let warnings: Issue[] = []
  try {
    // Lint the raw draft — linters don't care about sentinels; they look at
    // structural invariants. Parse a fresh copy so linters see comments/
    // anchors exactly as the operator wrote them. YAML parse already
    // succeeded in the preview above, but we re-parse here for strict
    // isolation (the preview doc may have been mutated by yaml's own
    // normalization heuristics, e.g. anchor resolution).
    const draftDoc = parseDocument(draft)
    const issues = runSharedLinters(draftDoc)
    const errs = errorIssues(issues)
    warnings = nonErrorIssues(issues)
    if (errs.length > 0) {
      onStep('lint', 'failed', { issues: errs })
      throw new DeployLintError(errs)
    }
    if (warnings.length > 0) {
      ctx.logger.info({
        msg: 'deploy: lint produced warnings only',
        count: warnings.length,
        codes: warnings.map((w) => w.code),
      })
    }
    onStep('lint', 'completed', { issueCount: warnings.length })
  } catch (e) {
    if (!(e instanceof DeployLintError)) {
      onStep('lint', 'failed', { error: (e as Error).message })
    }
    throw e
  }

  // =========================================================================
  // Step 3: snapshot (ALWAYS of CURRENT raw config, not the draft)
  // =========================================================================
  onStep('snapshot', 'running')
  let snapshotMeta: SnapshotMeta | null
  try {
    snapshotMeta = await ctx.snapshots.createSnapshot(current.content, {
      applied_by: appliedBy,
      ...(ctx.user_ip ? { user_ip: ctx.user_ip } : {}),
      ...(ctx.user_agent ? { user_agent: ctx.user_agent } : {}),
    })
  } catch (e) {
    onStep('snapshot', 'failed', { error: (e as Error).message })
    throw e
  }
  // createSnapshot returns null only for dedupe (auto-rollback with identical
  // masked content). In that case we still have a previous snapshot to point
  // the operator at — but that's a Task-16 concern. For step 3, we need a
  // non-null result. If dedupe happened, use the latest existing snapshot.
  if (!snapshotMeta) {
    const list = await ctx.snapshots.listSnapshots()
    snapshotMeta = list[0] ?? null
    if (!snapshotMeta) {
      const err = new Error('snapshot manager returned null but no prior snapshot exists')
      onStep('snapshot', 'failed', { error: err.message })
      throw err
    }
  }
  onStep('snapshot', 'completed', { snapshot_id: snapshotMeta.id })

  // =========================================================================
  // Step 4: preflight (mihomo-side validation)
  // =========================================================================
  onStep('preflight', 'running')
  try {
    const validation = await ctx.transport.runMihomoValidate(draftMaskedText)
    if (!validation.ok) {
      onStep('preflight', 'failed', {
        valid: false,
        errors: validation.errors,
      })
      throw new DeployPreflightError(validation)
    }
    onStep('preflight', 'completed', { valid: true })
  } catch (e) {
    if (!(e instanceof DeployPreflightError)) {
      onStep('preflight', 'failed', { error: (e as Error).message })
    }
    throw e
  }

  // =========================================================================
  // Step 5: write + reload (unmask if needed → atomic write → mihomo reload)
  // =========================================================================
  onStep('write-reload', 'running')
  try {
    // Unmask draft — if no sentinels, this is a no-op. If sentinels are
    // present (rollback path, or partial-edit UI that preserved some
    // originals), look up their plaintext values from the vault.
    const draftDocForWrite = parseDocument(draft)
    if (draftDocForWrite.errors.length > 0) {
      // Should have been caught in step 2; belt-and-braces.
      throw new Error(
        `draft YAML parse error at write time: ${draftDocForWrite.errors[0]!.message}`,
      )
    }
    await ctx.vault.unmaskDoc(draftDocForWrite)
    const unmaskedText = serialize(draftDocForWrite)

    // TOCTOU-guarded write. LocalFsTransport has `verifyAndWrite` that
    // re-reads under lock and compares hashes; for the generic interface we
    // fall back to `writeConfig` which relies on the lock alone. InMemory
    // ignores the lock file entirely.
    if (hasVerifyAndWrite(ctx.transport)) {
      await ctx.transport.verifyAndWrite(unmaskedText, ctx.lockFile, current.hash)
    } else {
      await ctx.transport.writeConfig(unmaskedText, ctx.lockFile)
    }

    // Reload mihomo. Fallback to docker/systemctl restart on 5xx/timeout is
    // a Task 16+ concern (execute via Bun.spawn); for MVP we just rethrow
    // with context so the caller surfaces the reload failure clearly.
    try {
      await ctx.mihomoApi.reloadConfig()
    } catch (reloadErr) {
      // TODO(Task 16): retry via `docker restart <MIHOMO_CONTAINER_NAME>`
      // or `sudo systemctl restart mihomo` when running LocalFs and the
      // HTTP error is 5xx / network timeout. For now, rethrow wrapped.
      throw new DeployWriteError(
        `mihomo reloadConfig failed: ${(reloadErr as Error).message}`,
        reloadErr as Error,
      )
    }
    onStep('write-reload', 'completed')
  } catch (e) {
    const errCode = (e as { code?: string }).code
    const errMsg = (e as Error).message
    onStep('write-reload', 'failed', {
      error: errMsg,
      ...(errCode ? { code: errCode } : {}),
    })
    throw e
  }

  // =========================================================================
  // Step 6: post-deploy healthcheck (+ auto-rollback on failure)
  // =========================================================================
  // Rollback is suppressed for `rollback` / `auto-rollback` / `canonicalization`
  // entries: rolling back a rollback re-introduces the regression we just
  // escaped, and rolling back a canonicalization snapshot is nonsensical (the
  // "before" state is a whitespace-only difference from the "after"). The
  // `rollback.ts` recursion guard handles the auto-rollback path; this
  // gate covers the manual ones.
  if (ctx.runHealthcheck) {
    onStep('healthcheck', 'running')
    let hcResult: HealthcheckResult
    try {
      hcResult = await ctx.runHealthcheck(ctx.mihomoApi, {
        onPhase: (phase, status, data) => {
          onStep('healthcheck', 'running', { phase, phaseStatus: status, ...(data ?? {}) })
        },
      })
    } catch (hcErr) {
      // Healthcheck runner itself threw — treat as a phase-1 failure
      // (API is unreachable). Fall through to the failure path below.
      hcResult = {
        ok: false,
        failedPhase: 1,
        diagnostics: { error: (hcErr as Error).message, reason: 'healthcheck-runner-threw' },
      }
    }
    if (hcResult.ok) {
      onStep('healthcheck', 'completed', {
        ...(hcResult.diagnostics ? { diagnostics: hcResult.diagnostics } : {}),
      })
    } else {
      onStep('healthcheck', 'failed', {
        ...(hcResult.failedPhase !== undefined ? { failedPhase: hcResult.failedPhase } : {}),
        ...(hcResult.diagnostics ? { diagnostics: hcResult.diagnostics } : {}),
      })
      // Auto-rollback trigger: phase 1 always rolls back (mihomo dead →
      // previous config is always safer); phase 3 rolls back only when
      // MIHARBOR_AUTO_ROLLBACK is enabled. Phase 2 is warn-only in the
      // healthcheck module so never reaches this branch.
      const isRollbackPath =
        appliedBy === 'rollback' ||
        appliedBy === 'auto-rollback' ||
        appliedBy === 'canonicalization'
      const shouldRollback =
        !isRollbackPath &&
        ctx.applyRollback !== undefined &&
        (hcResult.failedPhase === 1 || (hcResult.failedPhase === 3 && ctx.autoRollback === true))

      let rolledBackToSnapshotId: string | undefined
      let rollbackError: string | undefined
      if (shouldRollback && ctx.applyRollback) {
        onStep('rollback', 'running', { targetSnapshotId: snapshotMeta.id })
        try {
          const rbResult = await ctx.applyRollback({
            targetSnapshotId: snapshotMeta.id,
            onStep,
          })
          rolledBackToSnapshotId = rbResult.snapshot_id
          onStep('rollback', 'completed', { newSnapshotId: rbResult.snapshot_id })
        } catch (rbErr) {
          rollbackError = (rbErr as Error).message
          onStep('rollback', 'failed', { error: rollbackError })
        }
      }
      throw new DeployHealthcheckError({
        ...(hcResult.failedPhase !== undefined ? { failedPhase: hcResult.failedPhase } : {}),
        ...(hcResult.diagnostics ? { diagnostics: hcResult.diagnostics } : {}),
        ...(rolledBackToSnapshotId !== undefined ? { rolledBackToSnapshotId } : {}),
        ...(rollbackError !== undefined ? { rollbackError } : {}),
      })
    }
  }

  // =========================================================================
  // Success — record audit + return.
  // =========================================================================
  await ctx.audit.record({
    action:
      appliedBy === 'auto-rollback'
        ? 'auto-rollback'
        : appliedBy === 'rollback'
          ? 'rollback'
          : appliedBy === 'canonicalization'
            ? 'canonicalization'
            : 'deploy',
    ...(ctx.user ? { user: ctx.user } : {}),
    ...(ctx.user_ip ? { user_ip: ctx.user_ip } : {}),
    ...(ctx.user_agent ? { user_agent: ctx.user_agent } : {}),
    snapshot_id: snapshotMeta.id,
    diff_summary: diffSummary,
  })

  return {
    snapshot_id: snapshotMeta.id,
    diff: diffSummary,
    warnings,
  }
}

/** Type guard: does this Transport expose `verifyAndWrite` (TOCTOU-safe)? */
function hasVerifyAndWrite(t: Transport): t is Transport & {
  verifyAndWrite: (c: string, lock: string, expected: string) => Promise<void>
} {
  return typeof (t as { verifyAndWrite?: unknown }).verifyAndWrite === 'function'
}
