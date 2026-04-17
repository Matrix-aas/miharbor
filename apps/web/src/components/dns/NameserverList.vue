<script setup lang="ts">
// NameserverList — editable string array with add / remove.
// Used for every list field in the DNS section (nameserver, fallback,
// default-nameserver, direct-nameserver, proxy-server-nameserver,
// fake-ip-filter).
//
// Optional `validator` runs per-entry; when it returns a non-null reason the
// row renders a warning chevron. The guardrail plate above the list (when a
// `warning` prop is set) calls this out at the section level.

import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Trash2, AlertTriangle } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface Props {
  modelValue: string[]
  placeholder?: string
  /** Per-entry validator — returns a localized reason string when invalid. */
  validator?: (value: string) => string | null
  ariaLabel?: string
}

const props = defineProps<Props>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const { t } = useI18n()

// Work on a local mutable copy so inserts / removes are batched into one
// emit per user action rather than per keystroke.
const items = ref<string[]>([...props.modelValue])

// Keep local state in sync when the parent overrides (e.g. after a YAML
// round-trip reparse).
watch(
  () => props.modelValue,
  (next) => {
    // Only overwrite when the external value is structurally different so we
    // don't clobber in-flight edits.
    if (next.length !== items.value.length || next.some((v, i) => v !== items.value[i])) {
      items.value = [...next]
    }
  },
  { deep: true },
)

function commit(): void {
  emit('update:modelValue', [...items.value])
}

function updateAt(index: number, value: string): void {
  items.value[index] = value
  commit()
}

function addEntry(): void {
  items.value.push('')
  commit()
}

function removeAt(index: number): void {
  items.value.splice(index, 1)
  commit()
}

function warnFor(value: string): string | null {
  if (!props.validator) return null
  return props.validator(value)
}
</script>

<template>
  <div class="space-y-2" :aria-label="ariaLabel" role="group">
    <div
      v-for="(item, index) in items"
      :key="index"
      class="flex items-center gap-2"
      data-testid="nameserver-list-row"
    >
      <Input
        :model-value="item"
        :placeholder="placeholder ?? t('pages.dns.list.placeholder')"
        class="h-9"
        @update:model-value="(v: string | number) => updateAt(index, String(v))"
      />
      <AlertTriangle
        v-if="warnFor(item)"
        class="h-4 w-4 shrink-0 text-amber-500"
        :title="warnFor(item) ?? ''"
        data-testid="nameserver-row-warning"
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        :aria-label="t('pages.dns.list.remove')"
        @click="removeAt(index)"
      >
        <Trash2 class="h-4 w-4" />
      </Button>
    </div>
    <p v-if="items.length === 0" class="text-xs text-muted-foreground">
      {{ t('pages.dns.list.empty') }}
    </p>
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-testid="nameserver-list-add"
      @click="addEntry"
    >
      <Plus class="h-4 w-4" />
      {{ t('pages.dns.list.add') }}
    </Button>
  </div>
</template>
