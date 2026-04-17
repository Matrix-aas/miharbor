<script setup lang="ts">
// Deploy stepper — modal dialog that renders the 6-step pipeline driven
// by the deployStore. SSE consumption is in the store; this component is
// purely presentational + retry/close affordances.

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertCircle, Check, Circle, Loader2, X } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useDeployStore, type StepStatus } from '@/stores/deploy'

const { t } = useI18n()
const deploy = useDeployStore()

const open = computed({
  get: () => deploy.isOpen,
  set: (value: boolean) => {
    if (value) deploy.open()
    else deploy.close()
  },
})

const titleStatus = computed(() => {
  if (deploy.error) return 'error' as const
  if (deploy.completed) return 'ok' as const
  if (deploy.running) return 'running' as const
  return 'idle' as const
})

function statusIcon(status: StepStatus) {
  switch (status) {
    case 'running':
      return Loader2
    case 'ok':
      return Check
    case 'failed':
      return X
    default:
      return Circle
  }
}

function statusTone(status: StepStatus): string {
  switch (status) {
    case 'running':
      return 'text-primary'
    case 'ok':
      return 'text-emerald-500'
    case 'failed':
      return 'text-destructive'
    case 'skipped':
      return 'text-muted-foreground'
    default:
      return 'text-muted-foreground'
  }
}

function onRetry(): void {
  // After a failure, re-run the same pipeline with the current draft.
  deploy.reset()
  void deploy.startDeploy()
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <span>{{ t('deploy.title') }}</span>
          <Badge v-if="titleStatus === 'running'" variant="secondary">
            {{ t('deploy_live.running') }}
          </Badge>
          <Badge v-else-if="titleStatus === 'ok'" variant="default">
            {{ t('deploy_live.ok') }}
          </Badge>
          <Badge v-else-if="titleStatus === 'error'" variant="destructive">
            {{ t('deploy_live.error') }}
          </Badge>
        </DialogTitle>
        <DialogDescription>{{ t('deploy.subtitle') }}</DialogDescription>
      </DialogHeader>

      <ol class="space-y-3 py-2">
        <li
          v-for="(step, idx) in deploy.steps"
          :key="step.id"
          class="flex items-center gap-3 rounded-md border border-border/60 bg-muted/40 p-3"
        >
          <span class="text-xs text-muted-foreground">{{ idx + 1 }}.</span>
          <component
            :is="statusIcon(step.status)"
            class="h-4 w-4"
            :class="[statusTone(step.status), step.status === 'running' ? 'animate-spin' : '']"
          />
          <div class="flex flex-1 items-center justify-between gap-3">
            <div class="flex flex-col">
              <span class="text-sm font-medium">{{ t(`deploy.steps.${step.id}`) }}</span>
              <span v-if="step.message" class="text-xs text-destructive/90">{{
                step.message
              }}</span>
            </div>
            <span class="text-xs text-muted-foreground">
              {{ t(`deploy.status.${step.status}`) }}
            </span>
          </div>
        </li>
      </ol>

      <div
        v-if="deploy.error"
        class="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
      >
        <AlertCircle class="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div class="flex-1 space-y-1">
          <p class="font-medium">{{ deploy.error.code }}</p>
          <p class="text-xs opacity-90">{{ deploy.error.message }}</p>
        </div>
      </div>

      <p
        v-else-if="deploy.completed && deploy.lastSnapshotId"
        class="text-xs text-muted-foreground"
      >
        snapshot: <span class="font-mono">{{ deploy.lastSnapshotId }}</span>
      </p>

      <DialogFooter>
        <Button
          v-if="deploy.error"
          variant="outline"
          size="sm"
          :disabled="deploy.running"
          @click="onRetry"
        >
          {{ t('deploy_live.reconnect') }}
        </Button>
        <Button variant="outline" size="sm" @click="deploy.close">
          {{ t('deploy.close') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
