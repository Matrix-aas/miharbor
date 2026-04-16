// Deploy store — owns the 6-step pipeline state plus the SSE consumer that
// drives it. Consumers:
//   * DeployStepper.vue — reads `steps` and renders animated icons.
//   * Header.vue — calls `startDeploy()` on the Apply button.
//   * History.vue — calls `startRollback(id)` when operator selects rollback.
//
// SSE protocol (matches apps/server/src/routes/deploy.ts):
//   event: step   → { stepId: 'diff'|'lint'|'snapshot'|'preflight'|'write-reload'|'healthcheck',
//                     status: 'running'|'completed'|'failed', ...extra }
//   event: done   → { snapshot_id, summary, ... }
//   event: error  → { code, message, issues?, validation? }
//
// Because /api/deploy is a POST endpoint (body = draft in DraftStore),
// native EventSource can't be used. We use `fetch` + a ReadableStream reader
// that pipes through a TextDecoder + event-block splitter.

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Issue } from 'miharbor-shared'

export type StepStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped'

/** Step id as emitted by the server. Frontend maps 'write-reload' ↔
 *  'write_reload' for i18n key compatibility. */
export type ServerStepId =
  | 'diff'
  | 'lint'
  | 'snapshot'
  | 'preflight'
  | 'write-reload'
  | 'healthcheck'
export type UiStepId = 'diff' | 'lint' | 'snapshot' | 'preflight' | 'write_reload' | 'healthcheck'

export interface DeployStep {
  id: UiStepId
  status: StepStatus
  message?: string
  durationMs?: number
}

const INITIAL_STEPS: DeployStep[] = [
  { id: 'diff', status: 'pending' },
  { id: 'lint', status: 'pending' },
  { id: 'snapshot', status: 'pending' },
  { id: 'preflight', status: 'pending' },
  { id: 'write_reload', status: 'pending' },
  { id: 'healthcheck', status: 'pending' },
]

function freshSteps(): DeployStep[] {
  return INITIAL_STEPS.map((step) => ({ ...step }))
}

function serverToUiStepId(sid: ServerStepId): UiStepId {
  return (sid === 'write-reload' ? 'write_reload' : sid) as UiStepId
}

function serverToUiStatus(s: 'running' | 'completed' | 'failed'): StepStatus {
  if (s === 'completed') return 'ok'
  if (s === 'failed') return 'failed'
  return 'running'
}

export interface DeployError {
  code: string
  message: string
  issues?: Issue[]
  validation?: unknown
}

export const useDeployStore = defineStore('deploy', () => {
  const isOpen = ref(false)
  const running = ref(false)
  const steps = ref<DeployStep[]>(freshSteps())
  const error = ref<DeployError | null>(null)
  const lastSnapshotId = ref<string | null>(null)
  const completed = ref(false)
  /** Tracks the current stream so we can abort on navigation / close. */
  let abortController: AbortController | null = null

  function open(): void {
    isOpen.value = true
  }

  function close(): void {
    isOpen.value = false
    // Don't abort the stream here — the deploy continues server-side even
    // if the operator closes the dialog. They can reopen it from Apply.
  }

  function reset(): void {
    steps.value = freshSteps()
    error.value = null
    lastSnapshotId.value = null
    running.value = false
    completed.value = false
    if (abortController) {
      abortController.abort()
      abortController = null
    }
  }

  function setStep(id: UiStepId, status: StepStatus, message?: string): void {
    const step = steps.value.find((s) => s.id === id)
    if (!step) return
    step.status = status
    if (message !== undefined) step.message = message
  }

  function handleStepEvent(payload: unknown): void {
    if (typeof payload !== 'object' || payload === null) return
    const {
      stepId,
      status,
      error: stepErr,
    } = payload as {
      stepId?: ServerStepId
      status?: 'running' | 'completed' | 'failed'
      error?: string
    }
    if (!stepId || !status) return
    setStep(serverToUiStepId(stepId), serverToUiStatus(status), stepErr)
  }

  function handleDoneEvent(payload: unknown): void {
    if (payload && typeof payload === 'object' && 'snapshot_id' in payload) {
      lastSnapshotId.value = String((payload as { snapshot_id: unknown }).snapshot_id ?? '')
    }
    completed.value = true
    running.value = false
    // Mark remaining pending steps as skipped so the UI doesn't show a ◌
    // spinner forever on a step the server skipped (e.g. no-op snapshot).
    for (const step of steps.value) {
      if (step.status === 'pending') step.status = 'skipped'
    }
  }

  function handleErrorEvent(payload: unknown): void {
    const p = (payload ?? {}) as Partial<DeployError>
    error.value = {
      code: p.code ?? 'DEPLOY_FAILED',
      message: p.message ?? 'deploy failed',
      issues: p.issues,
      validation: p.validation,
    }
    running.value = false
    // Mark the currently-running step as failed if any.
    for (const step of steps.value) {
      if (step.status === 'running') {
        step.status = 'failed'
        step.message = error.value.message
      }
    }
  }

  /** Drain the fetch-SSE stream, parsing `event:`/`data:` blocks. */
  async function consumeStream(res: Response): Promise<void> {
    if (!res.body) throw new Error('no response body — cannot stream')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // SSE events are separated by blank lines (\n\n).
      let idx = buffer.indexOf('\n\n')
      while (idx !== -1) {
        const block = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        processBlock(block)
        idx = buffer.indexOf('\n\n')
      }
    }
    if (buffer.trim().length > 0) processBlock(buffer)
  }

  function processBlock(block: string): void {
    // A block is a sequence of `event: <name>` and `data: <payload>` lines.
    let event = 'message'
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue // comment — heartbeat
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    if (dataLines.length === 0) return
    const raw = dataLines.join('\n')
    let parsed: unknown = raw
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Leave raw as string — some events (heartbeats) are strings.
    }
    switch (event) {
      case 'step':
        handleStepEvent(parsed)
        break
      case 'done':
        handleDoneEvent(parsed)
        break
      case 'error':
        handleErrorEvent(parsed)
        break
      default:
        break
    }
  }

  /** POST /api/deploy and stream the 6-step pipeline. Resolves when the
   *  server closes the stream (done or error event). Throws only on
   *  network/parse failures — server-side deploy failures surface via
   *  `error.value`. */
  async function startDeploy(): Promise<void> {
    if (running.value) return
    reset()
    running.value = true
    abortController = new AbortController()
    try {
      const res = await fetch('/api/deploy', {
        method: 'POST',
        credentials: 'include',
        signal: abortController.signal,
      })
      if (!res.ok) {
        // Non-SSE error — e.g. NO_DRAFT 400. Parse JSON if possible.
        let body: unknown = null
        try {
          body = await res.json()
        } catch {
          /* ignore */
        }
        const msg =
          (body && typeof body === 'object' && 'message' in body
            ? String((body as { message: unknown }).message ?? '')
            : '') || `HTTP ${res.status}`
        error.value = { code: `HTTP_${res.status}`, message: msg }
        running.value = false
        return
      }
      await consumeStream(res)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      error.value = {
        code: 'STREAM_ERROR',
        message: e instanceof Error ? e.message : String(e),
      }
      running.value = false
    } finally {
      abortController = null
    }
  }

  /** Same as startDeploy but against `/api/snapshots/:id/rollback`. */
  async function startRollback(snapshotId: string): Promise<void> {
    if (running.value) return
    reset()
    running.value = true
    abortController = new AbortController()
    try {
      const res = await fetch(`/api/snapshots/${encodeURIComponent(snapshotId)}/rollback`, {
        method: 'POST',
        credentials: 'include',
        signal: abortController.signal,
      })
      if (!res.ok) {
        let body: unknown = null
        try {
          body = await res.json()
        } catch {
          /* ignore */
        }
        const msg =
          (body && typeof body === 'object' && 'message' in body
            ? String((body as { message: unknown }).message ?? '')
            : '') || `HTTP ${res.status}`
        error.value = { code: `HTTP_${res.status}`, message: msg }
        running.value = false
        return
      }
      await consumeStream(res)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      error.value = {
        code: 'STREAM_ERROR',
        message: e instanceof Error ? e.message : String(e),
      }
      running.value = false
    } finally {
      abortController = null
    }
  }

  return {
    isOpen,
    running,
    steps,
    error,
    lastSnapshotId,
    completed,
    open,
    close,
    reset,
    startDeploy,
    startRollback,
  }
})
