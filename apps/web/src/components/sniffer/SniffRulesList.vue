<script setup lang="ts">
// SniffRulesList — editable port-range list for a single sniffer protocol
// (HTTP / TLS / QUIC). Per-row port-range validation surfaces an amber
// chevron with the exact failure reason (empty, comma, reversed, >65535).
//
// Shape contract: the `modelValue` is a plain `string[]` of port ranges
// ("80", "8080-8090"). Commit on every mutation. The parent (Sniffer.vue)
// merges this slice into the per-protocol config and calls
// `setSnifferConfigDraft`. Empty-list semantics match DNS/TUN: an empty
// list bubbles up to the parent, which removes the protocol entry (or the
// whole `sniff:` map when everything is empty).
//
// HTTP alone supports a per-protocol `override-destination` — wired in via
// the optional `allowOverride` prop. When true, a checkbox renders above
// the list.

import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Trash2, AlertTriangle } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { validatePortRange } from 'miharbor-shared'
import type { SnifferProtocol } from 'miharbor-shared'

interface Props {
  protocol: SnifferProtocol
  modelValue: string[]
  /** HTTP-only: lets the user toggle per-protocol override-destination. */
  allowOverride?: boolean
  overrideDestination?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: string[]]
  'update:overrideDestination': [value: boolean]
}>()

const { t } = useI18n()

const items = ref<string[]>([...props.modelValue])

watch(
  () => props.modelValue,
  (next) => {
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
  return validatePortRange(value)
}

function onOverrideToggle(e: Event): void {
  emit('update:overrideDestination', (e.target as HTMLInputElement).checked)
}
</script>

<template>
  <div
    class="space-y-3"
    :aria-label="t('pages.sniffer.protocols.aria_label', { protocol })"
    role="group"
  >
    <label
      v-if="allowOverride"
      class="flex items-center gap-2 text-sm"
      :data-testid="`sniff-${protocol}-override-label`"
    >
      <input
        type="checkbox"
        class="h-4 w-4"
        :checked="overrideDestination ?? false"
        :aria-label="t('pages.sniffer.protocols.override_destination', { protocol })"
        :data-testid="`sniff-${protocol}-override`"
        @change="onOverrideToggle"
      />
      {{ t('pages.sniffer.protocols.override_destination', { protocol }) }}
    </label>

    <div
      v-for="(item, index) in items"
      :key="index"
      class="flex items-center gap-2"
      :data-testid="`sniff-${protocol}-row`"
    >
      <Input
        :model-value="item"
        :placeholder="t('pages.sniffer.protocols.placeholder')"
        class="h-9 flex-1"
        :aria-label="t('pages.sniffer.protocols.entry_aria', { protocol, index: index + 1 })"
        :data-testid="`sniff-${protocol}-input`"
        @update:model-value="(v: string | number) => updateAt(index, String(v))"
      />
      <AlertTriangle
        v-if="warnFor(item)"
        class="h-4 w-4 shrink-0 text-amber-500"
        :title="warnFor(item) ?? ''"
        :data-testid="`sniff-${protocol}-warning`"
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        :aria-label="t('pages.sniffer.protocols.remove')"
        :data-testid="`sniff-${protocol}-remove`"
        @click="removeAt(index)"
      >
        <Trash2 class="h-4 w-4" />
      </Button>
    </div>

    <p v-if="items.length === 0" class="text-xs text-muted-foreground">
      {{ t('pages.sniffer.protocols.empty') }}
    </p>

    <Button
      type="button"
      variant="outline"
      size="sm"
      :data-testid="`sniff-${protocol}-add`"
      @click="addEntry"
    >
      <Plus class="h-4 w-4" />
      {{ t('pages.sniffer.protocols.add') }}
    </Button>
  </div>
</template>
