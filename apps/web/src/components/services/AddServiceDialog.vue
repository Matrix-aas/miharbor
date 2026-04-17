<script setup lang="ts">
// AddServiceDialog — lightweight "create a proxy-group" wizard. MVP emits
// the form result so the store can `createNewService(...)` and PUT the
// updated draft. Smart name suggestions land in Task 42+.

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Props {
  open: boolean
  /** Existing group names — used for unique-name validation. */
  existingNames: string[]
}
const props = defineProps<Props>()
const emit = defineEmits<{
  'update:open': [v: boolean]
  create: [input: { name: string; direction: 'VPN' | 'DIRECT' | 'REJECT' }]
}>()

const { t } = useI18n()

const name = ref('')
const direction = ref<'VPN' | 'DIRECT' | 'REJECT'>('VPN')

// Reset fields whenever the dialog reopens so stale drafts don't leak across
// invocations.
watch(
  () => props.open,
  (v) => {
    if (v) {
      name.value = ''
      direction.value = 'VPN'
    }
  },
)

const NAME_RE = /^[A-Za-z0-9_\- .А-Яа-яЁё]+$/
const isTaken = computed(() => props.existingNames.includes(name.value.trim()))
const isValidName = computed(() => NAME_RE.test(name.value.trim()))
const canCreate = computed(
  () => name.value.trim().length > 0 && !isTaken.value && isValidName.value,
)

function onSubmit(): void {
  if (!canCreate.value) return
  emit('create', { name: name.value.trim(), direction: direction.value })
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="props.open" @update:open="(v: boolean) => emit('update:open', v)">
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ t('services.add_dialog.title') }}</DialogTitle>
        <DialogDescription>{{ t('services.add_dialog.direction_label') }}</DialogDescription>
      </DialogHeader>

      <form class="space-y-4" @submit.prevent="onSubmit">
        <div>
          <label class="mb-1 block text-xs font-medium text-muted-foreground">
            {{ t('services.add_dialog.name_label') }}
          </label>
          <Input
            v-model="name"
            :placeholder="t('services.add_dialog.name_placeholder')"
            class="h-9"
          />
          <p v-if="name.length > 0 && !isValidName" class="mt-1 text-xs text-destructive">
            {{ t('services.add_dialog.name_invalid') }}
          </p>
          <p v-else-if="isTaken" class="mt-1 text-xs text-destructive">
            {{ t('services.add_dialog.name_taken') }}
          </p>
        </div>

        <div>
          <p class="mb-1 block text-xs font-medium text-muted-foreground">
            {{ t('services.add_dialog.direction_label') }}
          </p>
          <div class="flex gap-2">
            <Button
              v-for="d in ['VPN', 'DIRECT', 'REJECT'] as const"
              :key="d"
              type="button"
              size="sm"
              :variant="direction === d ? 'default' : 'outline'"
              @click="direction = d"
            >
              {{ t('services.direction_' + d.toLowerCase()) }}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" type="button" @click="emit('update:open', false)">
            {{ t('common.cancel') }}
          </Button>
          <Button type="submit" size="sm" :disabled="!canCreate">
            {{ t('services.add_dialog.create') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
