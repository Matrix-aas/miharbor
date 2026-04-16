// /api/snapshots/* — history browser + rollback trigger.
//
// GET  /api/snapshots              → SnapshotMeta[]
// GET  /api/snapshots/:id          → masked config + meta + diff
// POST /api/snapshots/:id/rollback → SSE stream (same shape as /api/deploy)
//
// NB: masked config never needs to be unmasked at this endpoint — the UI
// renders it as-is so operators can visually diff "what I deployed back then"
// against "what's live now". Rollback unmasks server-side.

import { Elysia, t } from 'elysia'
import type { SnapshotManager } from '../deploy/snapshot.ts'
import type { DeployContext } from '../deploy/pipeline.ts'
import { applyRollback } from '../deploy/rollback.ts'
import { sseStreamFromEvents } from './sse.ts'
import { getAuthUser } from '../auth/basic-auth.ts'
import type { StepEvent } from '../deploy/pipeline.ts'

export interface SnapshotRoutesDeps {
  snapshots: SnapshotManager
  deployCtx: () => DeployContext
}

export function snapshotRoutes(deps: SnapshotRoutesDeps) {
  return new Elysia({ prefix: '/api/snapshots' })
    .get('/', async () => deps.snapshots.listSnapshots())
    .get(
      '/:id',
      async ({ params }) => {
        const { configMasked, meta } = await deps.snapshots.getSnapshot(params.id)
        return { meta, configMasked }
      },
      { params: t.Object({ id: t.String() }) },
    )
    .post(
      '/:id/rollback',
      async ({ params, request }) => {
        const user = getAuthUser(request) ?? 'anonymous'
        // Build an event queue drained by the SSE generator. The rollback
        // itself kicks off the standard pipeline which emits onStep.
        const ctx = deps.deployCtx()
        ctx.user = user
        const queue: Array<{ type: string; data: unknown }> = []
        let done = false
        let error: Error | null = null
        const onStep: StepEvent = (stepId, status, data) => {
          queue.push({ type: 'step', data: { stepId, status, ...(data ?? {}) } })
        }
        void applyRollback({
          snapshotId: params.id,
          deployCtx: ctx,
          snapshots: ctx.snapshots,
          vault: ctx.vault,
          logger: ctx.logger,
          onStep,
          auto: false,
        })
          .then((result) => {
            queue.push({ type: 'done', data: result })
            done = true
          })
          .catch((e: Error) => {
            error = e
            const anyErr = e as unknown as { code?: string; issues?: unknown }
            const payload: Record<string, unknown> = {
              code: anyErr.code ?? 'ROLLBACK_FAILED',
              message: e.message,
            }
            if (anyErr.issues !== undefined) payload.issues = anyErr.issues
            queue.push({ type: 'error', data: payload })
            done = true
          })
        return sseStreamFromEvents(() => ({
          queue,
          done: () => done,
          error: () => error,
        }))
      },
      { params: t.Object({ id: t.String() }) },
    )
}
