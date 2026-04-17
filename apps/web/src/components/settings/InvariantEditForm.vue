<script setup lang="ts">
// InvariantEditForm — inline create / edit form for a single UserInvariant.
// Emits `save` with the full entry on submit, `cancel` to close without
// changes. Validation is client-side only (required fields + id pattern);
// the server runs the same TypeBox schema on PUT so bad entries are caught
// either way.

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { X, Check } from 'lucide-vue-next'
import type { UserInvariant, UserInvariantRule } from 'miharbor-shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Props {
  /** Editing an existing entry — empty/absent means "new invariant". */
  invariant?: UserInvariant
  /** IDs already in the list (minus the row being edited). Prevents dupes. */
  existingIds: string[]
}

const props = defineProps<Props>()
const emit = defineEmits<{
  save: [invariant: UserInvariant]
  cancel: []
}>()

const { t } = useI18n()

type RuleKind = UserInvariantRule['kind']
const KINDS: RuleKind[] = [
  'path-must-equal',
  'path-must-not-equal',
  'path-must-be-in',
  'path-must-contain-all',
]

const id = ref('')
const name = ref('')
const level = ref<'error' | 'warning' | 'info'>('warning')
const active = ref(true)
const description = ref('')
const kind = ref<RuleKind>('path-must-equal')
const path = ref('')
const valueInput = ref('')
const valuesInput = ref('')

// ID validation pattern — MUST match the server schema.
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

function reset(from?: UserInvariant): void {
  if (from) {
    id.value = from.id
    name.value = from.name
    level.value = from.level ?? 'warning'
    active.value = from.active !== false
    description.value = from.description ?? ''
    kind.value = from.rule.kind
    path.value = from.rule.path
    if (from.rule.kind === 'path-must-equal') {
      valueInput.value = String(from.rule.value ?? '')
      valuesInput.value = ''
    } else {
      valueInput.value = ''
      valuesInput.value = from.rule.values.map(String).join('\n')
    }
  } else {
    id.value = ''
    name.value = ''
    level.value = 'warning'
    active.value = true
    description.value = ''
    kind.value = 'path-must-equal'
    path.value = ''
    valueInput.value = ''
    valuesInput.value = ''
  }
}

watch(
  () => props.invariant,
  (inv) => reset(inv),
  { immediate: true },
)

const isEdit = computed(() => props.invariant !== undefined)
const needsValues = computed(() => kind.value !== 'path-must-equal')

const idError = computed<string | null>(() => {
  if (id.value.length === 0) return t('settings.invariants_form_id_required')
  if (!ID_PATTERN.test(id.value)) return t('settings.invariants_form_id_bad_chars')
  if (props.existingIds.includes(id.value)) return t('settings.invariants_form_id_duplicate')
  return null
})
const nameError = computed(() =>
  name.value.trim().length === 0 ? t('settings.invariants_form_name_required') : null,
)
const pathError = computed(() =>
  path.value.trim().length === 0 ? t('settings.invariants_form_path_required') : null,
)
const valuesError = computed(() => {
  if (!needsValues.value) return null
  const parsed = parseValues()
  return parsed.length === 0 ? t('settings.invariants_form_rule_required_values') : null
})

const canSubmit = computed(
  () => !idError.value && !nameError.value && !pathError.value && !valuesError.value,
)

function parseValues(): string[] {
  return valuesInput.value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function buildRule(): UserInvariantRule {
  const p = path.value.trim()
  if (kind.value === 'path-must-equal') {
    // Coerce booleans / numbers / null from the input for convenience.
    const raw = valueInput.value.trim()
    let parsed: string | number | boolean | null = raw
    if (raw === 'true') parsed = true
    else if (raw === 'false') parsed = false
    else if (raw === 'null' || raw === '~') parsed = null
    else if (raw !== '' && /^-?\d+(\.\d+)?$/.test(raw)) parsed = Number(raw)
    return { kind: 'path-must-equal', path: p, value: parsed }
  }
  return { kind: kind.value, path: p, values: parseValues() }
}

function submit(): void {
  if (!canSubmit.value) return
  const entry: UserInvariant = {
    id: id.value.trim(),
    name: name.value.trim(),
    level: level.value,
    active: active.value,
    rule: buildRule(),
  }
  const desc = description.value.trim()
  if (desc.length > 0) entry.description = desc
  emit('save', entry)
}
</script>

<template>
  <form class="space-y-3 rounded border border-border bg-background p-4" @submit.prevent="submit">
    <div class="grid gap-3 sm:grid-cols-2">
      <div>
        <label class="mb-1 block text-xs font-medium text-muted-foreground">
          {{ t('settings.invariants_form_id') }}
        </label>
        <Input
          v-model="id"
          :placeholder="t('settings.invariants_form_id_placeholder')"
          :aria-label="t('settings.invariants_form_id')"
          :disabled="isEdit"
          data-testid="inv-form-id"
        />
        <p class="mt-1 text-[11px] text-muted-foreground">
          {{ t('settings.invariants_form_id_hint') }}
        </p>
        <p v-if="idError && id.length > 0" class="mt-1 text-xs text-destructive">{{ idError }}</p>
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-muted-foreground">
          {{ t('settings.invariants_form_name') }}
        </label>
        <Input
          v-model="name"
          :placeholder="t('settings.invariants_form_name_placeholder')"
          :aria-label="t('settings.invariants_form_name')"
          data-testid="inv-form-name"
        />
        <p v-if="nameError && name.length > 0" class="mt-1 text-xs text-destructive">
          {{ nameError }}
        </p>
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-muted-foreground">
          {{ t('settings.invariants_form_level') }}
        </label>
        <select
          v-model="level"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          :aria-label="t('settings.invariants_form_level')"
          data-testid="inv-form-level"
        >
          <option value="error">{{ t('settings.invariants_form_level_error') }}</option>
          <option value="warning">{{ t('settings.invariants_form_level_warning') }}</option>
          <option value="info">{{ t('settings.invariants_form_level_info') }}</option>
        </select>
      </div>

      <div class="flex items-end gap-2">
        <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            v-model="active"
            type="checkbox"
            :aria-label="t('settings.invariants_active_label')"
            data-testid="inv-form-active"
          />
          {{ t('settings.invariants_active_label') }}
        </label>
      </div>
    </div>

    <div>
      <label class="mb-1 block text-xs font-medium text-muted-foreground">
        {{ t('settings.invariants_form_description') }}
      </label>
      <textarea
        v-model="description"
        rows="2"
        class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        :placeholder="t('settings.invariants_form_description_placeholder')"
        :aria-label="t('settings.invariants_form_description')"
        data-testid="inv-form-description"
      />
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <div>
        <label class="mb-1 block text-xs font-medium text-muted-foreground">
          {{ t('settings.invariants_form_rule_kind') }}
        </label>
        <select
          v-model="kind"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          :aria-label="t('settings.invariants_form_rule_kind')"
          data-testid="inv-form-kind"
        >
          <option v-for="k in KINDS" :key="k" :value="k">
            {{ t(`settings.invariants_kind_${k.replace(/-/g, '_')}`) }}
          </option>
        </select>
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-muted-foreground">
          {{ t('settings.invariants_form_rule_path') }}
        </label>
        <Input
          v-model="path"
          :placeholder="t('settings.invariants_form_rule_path_placeholder')"
          :aria-label="t('settings.invariants_form_rule_path')"
          data-testid="inv-form-path"
        />
        <p v-if="pathError && path.length > 0" class="mt-1 text-xs text-destructive">
          {{ pathError }}
        </p>
      </div>
    </div>

    <div v-if="!needsValues">
      <label class="mb-1 block text-xs font-medium text-muted-foreground">
        {{ t('settings.invariants_form_rule_value') }}
      </label>
      <Input
        v-model="valueInput"
        :placeholder="t('settings.invariants_form_rule_values_placeholder')"
        :aria-label="t('settings.invariants_form_rule_value')"
        data-testid="inv-form-value"
      />
    </div>
    <div v-else>
      <label class="mb-1 block text-xs font-medium text-muted-foreground">
        {{ t('settings.invariants_form_rule_values') }}
      </label>
      <textarea
        v-model="valuesInput"
        rows="3"
        class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
        :placeholder="t('settings.invariants_form_rule_values_placeholder')"
        :aria-label="t('settings.invariants_form_rule_values')"
        data-testid="inv-form-values"
      />
      <p v-if="valuesError" class="mt-1 text-xs text-destructive">{{ valuesError }}</p>
    </div>

    <div class="flex items-center gap-2">
      <Button type="submit" :disabled="!canSubmit" data-testid="inv-form-save">
        <Check class="mr-1.5 h-3.5 w-3.5" />
        {{ t('settings.invariants_save') }}
      </Button>
      <Button type="button" variant="ghost" data-testid="inv-form-cancel" @click="emit('cancel')">
        <X class="mr-1.5 h-3.5 w-3.5" />
        {{ t('settings.invariants_cancel') }}
      </Button>
    </div>
  </form>
</template>
