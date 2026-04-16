// Deploy store — holds the six-step pipeline state plus UI flags
// (modal open/close). Task 26 wires the SSE stream from `/api/deploy` and
// updates step statuses in-place; for the skeleton this store only tracks
// local UI state.

import { defineStore } from 'pinia'
import { ref } from 'vue'

export type StepStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped'

export interface DeployStep {
  id: 'diff' | 'lint' | 'snapshot' | 'preflight' | 'write_reload' | 'healthcheck'
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

export const useDeployStore = defineStore('deploy', () => {
  const isOpen = ref(false)
  const running = ref(false)
  const steps = ref<DeployStep[]>(freshSteps())
  const error = ref<string | null>(null)
  const lastSnapshotId = ref<string | null>(null)

  function open(): void {
    isOpen.value = true
  }

  function close(): void {
    isOpen.value = false
  }

  function reset(): void {
    steps.value = freshSteps()
    error.value = null
    lastSnapshotId.value = null
    running.value = false
  }

  return { isOpen, running, steps, error, lastSnapshotId, open, close, reset }
})
