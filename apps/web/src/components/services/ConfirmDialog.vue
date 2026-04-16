<script setup lang="ts">
// ConfirmDialog — thin wrapper over shadcn's Dialog for destructive
// confirmations. Used by Services and Proxies screens for delete flows.
//
// Parent controls visibility via v-model:open. Emits `confirm` when the
// primary button fires, then closes itself (spec: operator sees immediate
// dismissal — async work unblocks in parallel).

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useI18n } from 'vue-i18n'

interface Props {
  open: boolean
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Paint the primary button in destructive red. Default: true. */
  destructive?: boolean
}
const props = withDefaults(defineProps<Props>(), { destructive: true })
const emit = defineEmits<{ 'update:open': [v: boolean]; confirm: [] }>()

const { t } = useI18n()

function onConfirm(): void {
  emit('confirm')
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="props.open" @update:open="(v: boolean) => emit('update:open', v)">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ props.title }}</DialogTitle>
        <DialogDescription v-if="props.body">{{ props.body }}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost" size="sm" @click="emit('update:open', false)">
          {{ props.cancelLabel ?? t('common.cancel') }}
        </Button>
        <Button
          :variant="props.destructive ? 'destructive' : 'default'"
          size="sm"
          @click="onConfirm"
        >
          {{ props.confirmLabel ?? t('common.confirm') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
