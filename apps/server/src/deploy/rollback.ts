// Auto-rollback orchestration. Called by the deploy pipeline (or the UI
// history screen) when the operator wants to re-apply a previous snapshot.
//
// Rollback = read masked snapshot → unmask via vault → feed BACK through the
// regular deploy pipeline with `appliedBy: 'rollback'` (manual) or
// `'auto-rollback'` (triggered by healthcheck failure).
//
// Recursion guard: auto-rollbacks set `_autoRollbackDepth` on the context;
// if we're already inside an auto-rollback when a new healthcheck failure
// hits, we do NOT roll back AGAIN (would mask the real regression in the
// snapshot we just restored). Depth 1 means "we're currently rolling back
// to this snapshot"; 2 means "healthcheck failed on the rollback itself" —
// at that point we log the failure and surface it to the UI without
// attempting another rollback cycle.

import { parseDocument } from 'yaml'
import type { Logger } from '../observability/logger.ts'
import { DUMP_OPTS } from '../config/canonicalize.ts'
import type { SnapshotManager } from './snapshot.ts'
import type { Vault } from '../vault/vault.ts'
import {
  runPipeline,
  type DeployContext,
  type RunPipelineResult,
  type StepEvent,
} from './pipeline.ts'

export interface RollbackContext {
  snapshotId: string
  deployCtx: DeployContext
  snapshots: SnapshotManager
  vault: Vault
  logger: Pick<Logger, 'info' | 'warn' | 'debug' | 'error'>
  onStep?: StepEvent
  auto: boolean
}

export class RollbackRecursionError extends Error {
  constructor() {
    super('rollback: refusing to auto-rollback an auto-rollback (depth guard)')
    this.name = 'RollbackRecursionError'
  }
}

/**
 * Apply snapshot `snapshotId` as a rollback through the standard deploy
 * pipeline. The restored config is loaded from the snapshot directory in
 * masked form and fed to `runPipeline` as the draft — the pipeline's step 5
 * unmask pass resolves sentinels back to real secrets before writing.
 *
 * Returns the `RunPipelineResult` (a fresh snapshot of the pre-rollback
 * state — the "new timeline" starts from this snapshot onwards).
 */
export async function applyRollback(rctx: RollbackContext): Promise<RunPipelineResult> {
  // Depth guard. We stash depth on the deployCtx to survive recursive calls.
  type CtxWithDepth = DeployContext & { _autoRollbackDepth?: number }
  const ctx = rctx.deployCtx as CtxWithDepth
  if (rctx.auto) {
    ctx._autoRollbackDepth = (ctx._autoRollbackDepth ?? 0) + 1
    if (ctx._autoRollbackDepth > 1) {
      // Reset guard before throwing so subsequent manual rollbacks work.
      ctx._autoRollbackDepth = 0
      throw new RollbackRecursionError()
    }
  }

  try {
    const { configMasked } = await rctx.snapshots.getSnapshot(rctx.snapshotId)
    // Unmask to the real secrets. We parse + unmask in one shot; the
    // pipeline will re-parse the draft text internally for step 1 / 2 / 5.
    const doc = parseDocument(configMasked)
    await rctx.vault.unmaskDoc(doc)
    const draftText = doc.toString(DUMP_OPTS)

    const appliedBy = rctx.auto ? 'auto-rollback' : 'rollback'
    const result = await runPipeline({
      draft: draftText,
      ctx: rctx.deployCtx,
      ...(rctx.onStep ? { onStep: rctx.onStep } : {}),
      appliedBy,
    })
    rctx.logger.info({
      msg: `rollback applied (${appliedBy})`,
      target_snapshot: rctx.snapshotId,
      new_snapshot: result.snapshot_id,
    })
    return result
  } finally {
    if (rctx.auto) {
      ctx._autoRollbackDepth = Math.max((ctx._autoRollbackDepth ?? 1) - 1, 0)
    }
  }
}
