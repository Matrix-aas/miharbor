<script setup lang="ts">
// InlineRulesEditor — editable list of rule strings for an `inline`
// rule-provider. Each entry is a rule body WITHOUT the "RULE-SET,<name>,"
// prefix, e.g. "DOMAIN-SUFFIX,example.com" or
// "IP-CIDR,10.0.0.0/8,no-resolve".
//
// Shape contract: `modelValue` is a plain `string[]`. We commit on every
// mutation so the parent (ProviderForm) can validate + propagate the patch
// immediately. Empty entries bubble up unchanged — validation at the form
// level decides whether to accept an empty list (required for type=inline).

import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Trash2 } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface Props {
  modelValue: string[]
  ariaLabel?: string
}

const props = defineProps<Props>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

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
</script>

<template>
  <div
    class="space-y-2"
    role="group"
    :aria-label="ariaLabel ?? t('pages.providers.inline.aria_label')"
    data-testid="inline-rules-editor"
  >
    <div
      v-for="(item, index) in items"
      :key="index"
      class="flex items-center gap-2"
      data-testid="inline-rules-row"
    >
      <Input
        :model-value="item"
        :placeholder="t('pages.providers.inline.placeholder')"
        class="h-9 flex-1 font-mono text-sm"
        :aria-label="t('pages.providers.inline.entry_aria', { index: index + 1 })"
        data-testid="inline-rules-input"
        @update:model-value="(v: string | number) => updateAt(index, String(v))"
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        :aria-label="t('pages.providers.inline.remove')"
        data-testid="inline-rules-remove"
        @click="removeAt(index)"
      >
        <Trash2 class="h-4 w-4" />
      </Button>
    </div>
    <p v-if="items.length === 0" class="text-xs text-muted-foreground">
      {{ t('pages.providers.inline.empty') }}
    </p>
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-testid="inline-rules-add"
      @click="addEntry"
    >
      <Plus class="h-4 w-4" />
      {{ t('pages.providers.inline.add') }}
    </Button>
  </div>
</template>
