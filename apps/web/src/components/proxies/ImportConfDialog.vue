<script setup lang="ts">
// ImportConfDialog — placeholder for full WireGuard .conf / subscription URL
// import flow. Lives behind the "Import from URL" button on the Proxies
// screen. Full implementation lands in v1.0 (Task 60); this dialog exists
// now so the button can have a consistent click target instead of a dead
// `disabled` badge.

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
}
defineProps<Props>()
const emit = defineEmits<{ 'update:open': [v: boolean] }>()
const { t } = useI18n()
</script>

<template>
  <Dialog :open="open" @update:open="(v: boolean) => emit('update:open', v)">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t('proxies.import') }}</DialogTitle>
        <DialogDescription>{{ t('proxies.import_placeholder') }}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" size="sm" @click="emit('update:open', false)">
          {{ t('common.close') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
