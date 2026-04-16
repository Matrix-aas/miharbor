<script setup lang="ts">
// RuleEditor — inline form for adding / editing a SimpleRule against a
// fixed target (the current service). Logical / MATCH rules are read-only
// in MVP; see RuleRow.
//
// Flow:
//   * parent renders `<RuleEditor>` inside a ServiceDetail "add rule" slot
//     OR in place of a RuleRow (when the row is in edit mode).
//   * emits `save(rule)` with the SimpleRule the user assembled.
//   * emits `cancel` to close without persisting.

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { SIMPLE_RULE_TYPES, type SimpleRule, type SimpleRuleType } from 'miharbor-shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { validateRuleValue } from '@/lib/rule-validation'

interface Props {
  target: string
  /** Optional — when supplied the form opens in edit mode. */
  initial?: SimpleRule
}
const props = defineProps<Props>()
const emit = defineEmits<{ save: [rule: SimpleRule]; cancel: [] }>()

const { t } = useI18n()

const type = ref<SimpleRuleType>(props.initial?.type ?? 'DOMAIN-SUFFIX')
const value = ref<string>(props.initial?.value ?? '')
const modifiersText = ref<string>((props.initial?.modifiers ?? []).join(', '))

watch(
  () => props.initial,
  (next) => {
    type.value = next?.type ?? 'DOMAIN-SUFFIX'
    value.value = next?.value ?? ''
    modifiersText.value = (next?.modifiers ?? []).join(', ')
  },
)

const modifiers = computed<string[]>(() =>
  modifiersText.value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
)

const validation = computed(() => validateRuleValue(type.value, value.value))
const canSave = computed(() => validation.value.ok)

function onSave(): void {
  if (!canSave.value) return
  const rule: SimpleRule = {
    kind: 'simple',
    type: type.value,
    value: value.value.trim(),
    target: props.target,
  }
  if (modifiers.value.length > 0) rule.modifiers = modifiers.value
  emit('save', rule)
}
</script>

<template>
  <form
    class="space-y-3 rounded-md border border-primary/40 bg-card/60 p-3"
    data-testid="rule-editor"
    @submit.prevent="onSave"
  >
    <div class="grid grid-cols-1 gap-3 md:grid-cols-[160px_1fr]">
      <div>
        <label class="mb-1 block text-xs font-medium text-muted-foreground">
          {{ t('rules.type_label') }}
        </label>
        <select
          v-model="type"
          class="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          <option v-for="rt in SIMPLE_RULE_TYPES" :key="rt" :value="rt">{{ rt }}</option>
        </select>
      </div>
      <div>
        <label class="mb-1 block text-xs font-medium text-muted-foreground">
          {{ t('rules.value_label') }}
        </label>
        <Input v-model="value" class="h-9 font-mono" :placeholder="type" />
        <p
          v-if="!validation.ok && value.length > 0"
          class="mt-1 text-xs text-destructive"
          data-testid="rule-editor-error"
        >
          {{ t(validation.messageKey) }}
        </p>
      </div>
    </div>

    <div>
      <label class="mb-1 block text-xs font-medium text-muted-foreground">
        {{ t('rules.modifiers_label') }}
      </label>
      <Input v-model="modifiersText" class="h-9" :placeholder="t('rules.modifiers_placeholder')" />
      <div v-if="modifiers.length > 0" class="mt-2 flex flex-wrap gap-1">
        <Badge v-for="mod in modifiers" :key="mod" variant="muted" class="text-[10px]">
          {{ mod }}
        </Badge>
      </div>
    </div>

    <div class="flex justify-end gap-2">
      <Button type="button" variant="ghost" size="sm" @click="emit('cancel')">
        {{ t('rules.cancel') }}
      </Button>
      <Button type="submit" size="sm" :disabled="!canSave">
        {{ t('rules.save') }}
      </Button>
    </div>
  </form>
</template>
