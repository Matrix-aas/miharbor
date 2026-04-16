<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Circle, Loader2, X } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
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
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-xl">
      <DialogHeader>
        <DialogTitle>{{ t('deploy.title') }}</DialogTitle>
        <DialogDescription>{{ t('deploy.subtitle') }}</DialogDescription>
      </DialogHeader>

      <ol class="space-y-3 py-4">
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
            <span class="text-sm font-medium">{{ t(`deploy.steps.${step.id}`) }}</span>
            <span class="text-xs text-muted-foreground">
              {{ t(`deploy.status.${step.status}`) }}
            </span>
          </div>
        </li>
      </ol>

      <p class="text-xs text-muted-foreground">{{ t('deploy.skeleton_note') }}</p>

      <DialogFooter>
        <Button variant="outline" size="sm" @click="deploy.close">
          {{ t('deploy.close') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
