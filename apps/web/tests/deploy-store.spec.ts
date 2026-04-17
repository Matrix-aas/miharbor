// deployStore tests — exercise the SSE parser with a synthesised fetch
// response body. Uses jsdom's ReadableStream + a stubbed global fetch.
//
// We don't hit a real server; the focus is:
//   * `event: step` progresses the matching UI step from running → ok.
//   * `event: error` flips the current running step to 'failed' and
//     populates `store.error`.
//   * `event: done` fills `lastSnapshotId` and marks remaining pending
//     steps as 'skipped'.

import { describe, expect, it, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDeployStore } from '../src/stores/deploy'

function makeSseResponse(frames: string[]): Response {
  const encoded = frames.map((f) => new TextEncoder().encode(f))
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of encoded) controller.enqueue(chunk)
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('deployStore SSE integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('advances step statuses on step events', async () => {
    const frames = [
      'event: step\ndata: {"stepId":"diff","status":"running"}\n\n',
      'event: step\ndata: {"stepId":"diff","status":"completed"}\n\n',
      'event: step\ndata: {"stepId":"lint","status":"running"}\n\n',
      'event: step\ndata: {"stepId":"lint","status":"completed"}\n\n',
      'event: done\ndata: {"snapshot_id":"2026-04-16T00-00-00-abcdef12"}\n\n',
    ]
    globalThis.fetch = (() => Promise.resolve(makeSseResponse(frames))) as unknown as typeof fetch
    const store = useDeployStore()
    await store.startDeploy()
    const diff = store.steps.find((s) => s.id === 'diff')
    const lint = store.steps.find((s) => s.id === 'lint')
    const healthcheck = store.steps.find((s) => s.id === 'healthcheck')
    expect(diff?.status).toBe('ok')
    expect(lint?.status).toBe('ok')
    // Untouched steps get 'skipped' on done — they weren't run.
    expect(healthcheck?.status).toBe('skipped')
    expect(store.lastSnapshotId).toBe('2026-04-16T00-00-00-abcdef12')
    expect(store.completed).toBe(true)
    expect(store.running).toBe(false)
    expect(store.error).toBeNull()
  })

  it('marks the running step failed on error event', async () => {
    const frames = [
      'event: step\ndata: {"stepId":"diff","status":"completed"}\n\n',
      'event: step\ndata: {"stepId":"lint","status":"running"}\n\n',
      'event: error\ndata: {"code":"LINT_ERROR","message":"unreachable rule"}\n\n',
    ]
    globalThis.fetch = (() => Promise.resolve(makeSseResponse(frames))) as unknown as typeof fetch
    const store = useDeployStore()
    await store.startDeploy()
    expect(store.error?.code).toBe('LINT_ERROR')
    expect(store.error?.message).toBe('unreachable rule')
    const lint = store.steps.find((s) => s.id === 'lint')
    expect(lint?.status).toBe('failed')
    expect(lint?.message).toBe('unreachable rule')
  })

  it('translates the server write-reload id to the web write_reload id', async () => {
    const frames = [
      'event: step\ndata: {"stepId":"write-reload","status":"running"}\n\n',
      'event: step\ndata: {"stepId":"write-reload","status":"completed"}\n\n',
      'event: done\ndata: {"snapshot_id":"x"}\n\n',
    ]
    globalThis.fetch = (() => Promise.resolve(makeSseResponse(frames))) as unknown as typeof fetch
    const store = useDeployStore()
    await store.startDeploy()
    const wr = store.steps.find((s) => s.id === 'write_reload')
    expect(wr?.status).toBe('ok')
  })

  it('surfaces non-streaming errors (400 NO_DRAFT)', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ code: 'NO_DRAFT', message: 'no draft' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      )) as unknown as typeof fetch
    const store = useDeployStore()
    await store.startDeploy()
    expect(store.error?.code).toBe('HTTP_400')
    expect(store.error?.message).toBe('no draft')
    expect(store.running).toBe(false)
  })

  it('startRollback targets the /api/snapshots/:id/rollback endpoint', async () => {
    let capturedUrl: string | null = null
    globalThis.fetch = ((url: string) => {
      capturedUrl = url
      return Promise.resolve(makeSseResponse(['event: done\ndata: {"snapshot_id":"y"}\n\n']))
    }) as unknown as typeof fetch
    const store = useDeployStore()
    await store.startRollback('2026-04-16T00-00-00-abc')
    expect(capturedUrl).toBe('/api/snapshots/2026-04-16T00-00-00-abc/rollback')
    expect(store.lastSnapshotId).toBe('y')
  })
})
