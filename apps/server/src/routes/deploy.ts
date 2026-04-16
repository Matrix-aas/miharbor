// POST /api/deploy → SSE stream emitting step events from the 5-step pipeline
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
  deployCtx: () => DeployContext
}

export function deployRoutes(deps: DeployRoutesDeps) {
  return new Elysia({ prefix: '/api' }).post('/deploy', async ({ request, set }) => {
    const user = getAuthUser(request) ?? 'anonymous'
    const draft = deps.draftStore.get(user)
    if (!draft) {
      set.status = 400
      return {
        code: 'NO_DRAFT',
        message: 'no draft on file — PUT /api/config/draft first',
      }
    }

    const ctx = deps.deployCtx()
    ctx.user = user

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
        const code = (e as { code?: string }).code ?? 'DEPLOY_FAILED'
        const issues = (e as { issues?: unknown }).issues
        const validation = (e as { validation?: unknown }).validation
        queue.push({
          type: 'error',
          data: {
            code,
            message: e.message,
            ...(issues !== undefined ? { issues } : {}),
            ...(validation !== undefined ? { validation } : {}),
          },
        })
        done = true
      })

    return sseStreamFromEvents(() => ({
      queue,
      done: () => done,
      error: () => error,
    }))
  })
}
