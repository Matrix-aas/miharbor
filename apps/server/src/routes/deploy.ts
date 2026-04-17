// POST /api/deploy → SSE stream emitting step events from the 6-step pipeline
// plus a final `done` event (with snapshot_id) or an `error` event (with
// typed code). The draft used is the one currently stored in DraftStore for
// the caller; a 400 is returned if no draft has been PUT yet.

import { Elysia } from 'elysia'
import type { DraftStore } from '../draft-store.ts'
import type { DeployContext } from '../deploy/pipeline.ts'
import { runPipeline } from '../deploy/pipeline.ts'
import { sseStreamFromEvents } from './sse.ts'
import { getAuthUser } from '../auth/basic-auth.ts'
import type { StepEvent } from '../deploy/pipeline.ts'

export interface DeployRoutesDeps {
  draftStore: DraftStore
  deployCtx: (user?: string, user_ip?: string, user_agent?: string) => DeployContext
}

export function deployRoutes(deps: DeployRoutesDeps) {
  return new Elysia({ prefix: '/api' }).post('/deploy', async ({ request, set, server }) => {
    const user = getAuthUser(request) ?? 'anonymous'
    const draft = deps.draftStore.get(user)
    if (!draft) {
      set.status = 400
      return {
        code: 'NO_DRAFT',
        message: 'no draft on file — PUT /api/config/draft first',
      }
    }

    // Populate identity from the live request. user_ip is the socket IP
    // (trust-proxy headers are NOT used for audit-log — we want ground truth,
    // and the Basic-Auth middleware already rejected untrusted spoofing).
    let socketIp: string | undefined
    try {
      const addr = server?.requestIP(request)
      if (addr && typeof addr.address === 'string') socketIp = addr.address
    } catch {
      /* ignore */
    }
    const userAgent = request.headers.get('user-agent') ?? undefined
    const ctx = deps.deployCtx(user, socketIp, userAgent)

    const queue: Array<{ type: string; data: unknown }> = []
    let done = false
    let error: Error | null = null
    const onStep: StepEvent = (stepId, status, data) => {
      queue.push({ type: 'step', data: { stepId, status, ...(data ?? {}) } })
    }

    void runPipeline({
      draft: draft.text,
      ctx,
      onStep,
    })
      .then((result) => {
        queue.push({ type: 'done', data: result })
        // Drop the draft — it's now live.
        deps.draftStore.clear(user)
        done = true
      })
      .catch((e: Error) => {
        error = e
        const anyErr = e as unknown as {
          code?: string
          issues?: unknown
          validation?: unknown
          failedPhase?: number
          diagnostics?: Record<string, unknown>
          rolledBackToSnapshotId?: string
          rollbackError?: string
        }
        const payload: Record<string, unknown> = {
          code: anyErr.code ?? 'DEPLOY_FAILED',
          message: e.message,
        }
        if (anyErr.issues !== undefined) payload.issues = anyErr.issues
        if (anyErr.validation !== undefined) payload.validation = anyErr.validation
        if (anyErr.failedPhase !== undefined) payload.failedPhase = anyErr.failedPhase
        if (anyErr.diagnostics !== undefined) payload.diagnostics = anyErr.diagnostics
        if (anyErr.rolledBackToSnapshotId !== undefined) {
          payload.rolledBackToSnapshotId = anyErr.rolledBackToSnapshotId
        }
        if (anyErr.rollbackError !== undefined) payload.rollbackError = anyErr.rollbackError
        queue.push({ type: 'error', data: payload })
        done = true
      })

    return sseStreamFromEvents(() => ({
      queue,
      done: () => done,
      error: () => error,
    }))
  })
}
