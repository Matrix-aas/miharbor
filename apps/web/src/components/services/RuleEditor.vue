<script setup lang="ts">
// RuleEditor — inline form for adding / editing a SimpleRule against a
// fixed target (the current service). Logical / MATCH rules are read-only
// in MVP; see RuleRow.
//
// Flow:
//   * parent renders `<RuleEditor>` inside a ServiceDetail "add rule" slot
//     OR in place of a RuleRow (when the row is in edit mode).
//   * emits `save(rule, suggestedIndex)` with the SimpleRule the user assembled
//     and the optional suggestedIndex for placement.
//   * emits `cancel` to close without persisting.

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  SIMPLE_RULE_TYPES,
  type SimpleRule,
  type SimpleRuleType,
  type Rule,
  suggestPlacement,
} from 'miharbor-shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { validateRuleValue } from '@/lib/rule-validation'
import GeoCatalogCombobox from './GeoCatalogCombobox.vue'
import RuleSetCombobox from './RuleSetCombobox.vue'

interface Props {
  target: string
  /** Optional — when supplied the form opens in edit mode. */
  initial?: SimpleRule
  /** List of existing rules in the service — used for placement suggestion. */
  existingRules?: Rule[]
}
const props = withDefaults(defineProps<Props>(), {
  existingRules: () => [],
})
const emit = defineEmits<{ save: [rule: SimpleRule, suggestedIndex?: number]; cancel: [] }>()

const { t } = useI18n()

const type = ref<SimpleRuleType>(props.initial?.type ?? 'DOMAIN-SUFFIX')
const value = ref<string>(props.initial?.value ?? '')
const modifiersText = ref<string>((props.initial?.modifiers ?? []).join(', '))
const useCustomIndex = ref<boolean>(false)
const customIndex = ref<number>(0)

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

const isGeoType = computed(
  () => type.value === 'GEOSITE' || type.value === 'GEOIP' || type.value === 'SRC-GEOIP',
)
const comboType = computed<'GEOSITE' | 'GEOIP'>(() =>
  type.value === 'SRC-GEOIP' ? 'GEOIP' : (type.value as 'GEOSITE' | 'GEOIP'),
)
const isRuleSetType = computed(() => type.value === 'RULE-SET')

// Placement suggestion — only show when adding (not editing).
const isAddingMode = computed(() => !props.initial)

const placementSuggestion = computed(() => {
  if (!isAddingMode.value || !validation.value.ok) return null
  const newRule: SimpleRule = {
    kind: 'simple',
    type: type.value,
    value: value.value.trim(),
    target: props.target,
  }
  if (modifiers.value.length > 0) newRule.modifiers = modifiers.value
  return suggestPlacement(newRule, props.existingRules)
})

// Compute the index to use — either the suggested one or the custom override.
const suggestedIndexValue = computed(() => placementSuggestion.value?.index ?? 0)

watch(
  () => suggestedIndexValue.value,
  (newSuggested) => {
    customIndex.value = newSuggested
  },
)

const finalIndex = computed(() =>
  useCustomIndex.value ? customIndex.value : suggestedIndexValue.value,
)

function onSave(): void {
  if (!canSave.value) return
  const rule: SimpleRule = {
    kind: 'simple',
    type: type.value,
    value: value.value.trim(),
    target: props.target,
  }
  if (modifiers.value.length > 0) rule.modifiers = modifiers.value
  // Pass the suggested or custom index for placement.
  emit('save', rule, isAddingMode.value ? finalIndex.value : undefined)
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
        <GeoCatalogCombobox v-if="isGeoType" v-model="value" :type="comboType" />
        <RuleSetCombobox v-else-if="isRuleSetType" v-model="value" />
        <Input v-else v-model="value" class="h-9 font-mono" :placeholder="type" />
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

    <!-- Placement suggestion — only shown when adding a new rule -->
    <div
      v-if="placementSuggestion && isAddingMode"
      class="rounded-md bg-muted/40 p-2 text-xs space-y-2"
      data-testid="placement-suggestion"
    >
      <div class="font-medium">
        {{ t('rules.placement.suggested') }}:
        <span class="text-primary">
          {{ t('rules.placement.after_rule', { index: suggestedIndexValue }) }}
        </span>
      </div>
      <p class="text-muted-foreground">
        {{ t(`rules.placement.${placementSuggestion.reason}`) }}
      </p>
      <div class="flex items-center gap-2">
        <Checkbox
          v-model:checked="useCustomIndex"
          :id="`placement-override-${props.target}`"
          class="h-4 w-4"
        />
        <Label
          :for="`placement-override-${props.target}`"
          class="text-xs cursor-pointer font-normal"
        >
          {{ t('rules.placement.override_checkbox') }}
        </Label>
        <Input
          v-if="useCustomIndex"
          v-model.number="customIndex"
          type="number"
          class="h-7 w-12 font-mono text-xs"
          :min="0"
          :max="props.existingRules.length"
          :aria-label="`Custom placement index (0 to ${props.existingRules.length})`"
        />
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
