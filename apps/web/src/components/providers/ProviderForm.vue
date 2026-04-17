<script setup lang="ts">
// ProviderForm — add / edit form for a single rule-provider entry.
//
// Props:
//   modelValue     → RuleProviderConfig (initial state; empty means Add flow)
//   name           → current provider name (empty = new provider)
//   existingNames  → used to reject name collisions on Add
//   isEdit         → true when editing; name becomes read-only
//
// Emits:
//   submit { name, config }   → user hit Save with a valid payload
//   cancel                    → user hit Cancel
//
// Validation rules:
//   * name: required, no whitespace, no commas (mihomo parses rule bodies
//     with commas so a comma in the name would break `RULE-SET,name,PROXY`)
//   * type=http: url + interval (>0) required
//   * type=file: path required
//   * type=inline: payload (≥1 entry, each non-empty after trim) required

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  RuleProviderBehavior,
  RuleProviderConfig,
  RuleProviderFormat,
  RuleProviderType,
} from 'miharbor-shared'
import { validateProviderConfig, validateProviderName } from 'miharbor-shared'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import InlineRulesEditor from './InlineRulesEditor.vue'

interface Props {
  modelValue: RuleProviderConfig
  name: string
  existingNames: string[]
  isEdit: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  submit: [payload: { name: string; config: RuleProviderConfig }]
  cancel: []
}>()

const { t } = useI18n()

// Local form state — committed to the parent only on submit, so the user
// can cancel without side effects.
const localName = ref<string>(props.name)
const localType = ref<RuleProviderType>(props.modelValue.type ?? 'http')
const localBehavior = ref<RuleProviderBehavior>(props.modelValue.behavior ?? 'classical')
const localFormat = ref<RuleProviderFormat | ''>(props.modelValue.format ?? 'yaml')
const localUrl = ref<string>(props.modelValue.url ?? '')
const localInterval = ref<string>(
  props.modelValue.interval !== undefined ? String(props.modelValue.interval) : '86400',
)
const localProxy = ref<string>(props.modelValue.proxy ?? '')
const localPath = ref<string>(props.modelValue.path ?? '')
const localPayload = ref<string[]>([...(props.modelValue.payload ?? [])])

// Re-sync when the parent swaps modelValue (e.g. switching between providers
// in an edit list). Guard against identity-equal resets by comparing key
// fields only.
watch(
  () => props.modelValue,
  (next) => {
    localType.value = next.type ?? 'http'
    localBehavior.value = next.behavior ?? 'classical'
    localFormat.value = next.format ?? 'yaml'
    localUrl.value = next.url ?? ''
    localInterval.value = next.interval !== undefined ? String(next.interval) : '86400'
    localProxy.value = next.proxy ?? ''
    localPath.value = next.path ?? ''
    localPayload.value = [...(next.payload ?? [])]
  },
  { deep: true },
)

watch(
  () => props.name,
  (next) => {
    localName.value = next
  },
)

// ----- validation --------------------------------------------------------

const nameError = computed<string | null>(() => {
  const v = validateProviderName(localName.value)
  if (v !== null) return v
  // In add mode, reject collisions. In edit mode, the name is read-only so
  // it's safe to skip this check.
  if (!props.isEdit) {
    if (props.existingNames.includes(localName.value.trim())) {
      return t('pages.providers.form.name_taken')
    }
  }
  return null
})

function buildConfig(): RuleProviderConfig {
  const out: RuleProviderConfig = {
    type: localType.value,
    behavior: localBehavior.value,
  }
  if (localFormat.value !== '' && localType.value !== 'inline') {
    out.format = localFormat.value
  }
  if (localType.value === 'http') {
    if (localUrl.value.trim().length > 0) out.url = localUrl.value.trim()
    const n = Number(localInterval.value)
    if (Number.isFinite(n) && n > 0) out.interval = n
    if (localProxy.value.trim().length > 0) out.proxy = localProxy.value.trim()
  } else if (localType.value === 'file') {
    if (localPath.value.trim().length > 0) out.path = localPath.value.trim()
  } else if (localType.value === 'inline') {
    const payload = localPayload.value.map((x) => x.trim()).filter((x) => x.length > 0)
    if (payload.length > 0) out.payload = payload
  }
  // Preserve any unknown extras from the original model value so round-trip
  // is non-destructive when the user edits only visible fields.
  if (props.modelValue.extras) {
    out.extras = { ...props.modelValue.extras }
  }
  return out
}

const configError = computed<string | null>(() => {
  const cfg = buildConfig()
  const err = validateProviderConfig(cfg)
  if (err === null) return null
  // Translate the engine-level reason into a localised message.
  if (err.includes('url')) return t('pages.providers.form.err_url_required')
  if (err.includes('interval')) return t('pages.providers.form.err_interval_required')
  if (err.includes('path')) return t('pages.providers.form.err_path_required')
  if (err.includes('payload')) return t('pages.providers.form.err_payload_required')
  return err
})

const canSubmit = computed<boolean>(() => nameError.value === null && configError.value === null)

function onSubmit(): void {
  if (!canSubmit.value) return
  emit('submit', { name: localName.value.trim(), config: buildConfig() })
}

function onCancel(): void {
  emit('cancel')
}
</script>

<template>
  <form class="space-y-4" data-testid="provider-form" @submit.prevent="onSubmit">
    <!-- Name -->
    <div class="space-y-1">
      <label for="provider-name" class="block text-xs font-medium uppercase text-muted-foreground">
        {{ t('pages.providers.form.name') }}
      </label>
      <Input
        id="provider-name"
        v-model="localName"
        :placeholder="t('pages.providers.form.name_placeholder')"
        :aria-label="t('pages.providers.form.name')"
        :disabled="isEdit"
        data-testid="provider-form-name"
      />
      <p v-if="nameError" class="text-xs text-destructive" data-testid="provider-form-name-error">
        {{ nameError }}
      </p>
    </div>

    <!-- Type -->
    <div class="space-y-1">
      <label for="provider-type" class="block text-xs font-medium uppercase text-muted-foreground">
        {{ t('pages.providers.form.type') }}
      </label>
      <select
        id="provider-type"
        v-model="localType"
        :aria-label="t('pages.providers.form.type')"
        data-testid="provider-form-type"
        class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="http">{{ t('pages.providers.types.http') }}</option>
        <option value="file">{{ t('pages.providers.types.file') }}</option>
        <option value="inline">{{ t('pages.providers.types.inline') }}</option>
      </select>
    </div>

    <!-- Behavior -->
    <div class="space-y-1">
      <label
        for="provider-behavior"
        class="block text-xs font-medium uppercase text-muted-foreground"
      >
        {{ t('pages.providers.form.behavior') }}
      </label>
      <select
        id="provider-behavior"
        v-model="localBehavior"
        :aria-label="t('pages.providers.form.behavior')"
        data-testid="provider-form-behavior"
        class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="domain">{{ t('pages.providers.behaviors.domain') }}</option>
        <option value="ipcidr">{{ t('pages.providers.behaviors.ipcidr') }}</option>
        <option value="classical">{{ t('pages.providers.behaviors.classical') }}</option>
      </select>
    </div>

    <!-- Format (http/file only) -->
    <div v-if="localType !== 'inline'" class="space-y-1">
      <label
        for="provider-format"
        class="block text-xs font-medium uppercase text-muted-foreground"
      >
        {{ t('pages.providers.form.format') }}
      </label>
      <select
        id="provider-format"
        v-model="localFormat"
        :aria-label="t('pages.providers.form.format')"
        data-testid="provider-form-format"
        class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="yaml">yaml</option>
        <option value="text">text</option>
        <option value="mrs">mrs</option>
      </select>
    </div>

    <!-- HTTP-specific fields -->
    <template v-if="localType === 'http'">
      <div class="space-y-1">
        <label for="provider-url" class="block text-xs font-medium uppercase text-muted-foreground">
          {{ t('pages.providers.form.url') }}
        </label>
        <Input
          id="provider-url"
          v-model="localUrl"
          :placeholder="t('pages.providers.form.url_placeholder')"
          :aria-label="t('pages.providers.form.url')"
          data-testid="provider-form-url"
        />
      </div>
      <div class="space-y-1">
        <label
          for="provider-interval"
          class="block text-xs font-medium uppercase text-muted-foreground"
        >
          {{ t('pages.providers.form.interval') }}
        </label>
        <Input
          id="provider-interval"
          v-model="localInterval"
          type="number"
          min="1"
          :placeholder="t('pages.providers.form.interval_placeholder')"
          :aria-label="t('pages.providers.form.interval')"
          data-testid="provider-form-interval"
        />
        <p class="text-xs text-muted-foreground">{{ t('pages.providers.form.interval_hint') }}</p>
      </div>
      <div class="space-y-1">
        <label
          for="provider-proxy"
          class="block text-xs font-medium uppercase text-muted-foreground"
        >
          {{ t('pages.providers.form.proxy') }}
        </label>
        <Input
          id="provider-proxy"
          v-model="localProxy"
          :placeholder="t('pages.providers.form.proxy_placeholder')"
          :aria-label="t('pages.providers.form.proxy')"
          data-testid="provider-form-proxy"
        />
        <p class="text-xs text-muted-foreground">{{ t('pages.providers.form.proxy_hint') }}</p>
      </div>
    </template>

    <!-- File-specific fields -->
    <template v-if="localType === 'file'">
      <div class="space-y-1">
        <label
          for="provider-path"
          class="block text-xs font-medium uppercase text-muted-foreground"
        >
          {{ t('pages.providers.form.path') }}
        </label>
        <Input
          id="provider-path"
          v-model="localPath"
          :placeholder="t('pages.providers.form.path_placeholder')"
          :aria-label="t('pages.providers.form.path')"
          data-testid="provider-form-path"
        />
        <p class="text-xs text-muted-foreground">{{ t('pages.providers.form.path_hint') }}</p>
      </div>
    </template>

    <!-- Inline payload editor -->
    <template v-if="localType === 'inline'">
      <div class="space-y-1">
        <label class="block text-xs font-medium uppercase text-muted-foreground">
          {{ t('pages.providers.form.payload') }}
        </label>
        <p class="text-xs text-muted-foreground">{{ t('pages.providers.form.payload_hint') }}</p>
        <InlineRulesEditor
          :model-value="localPayload"
          @update:model-value="(v: string[]) => (localPayload = v)"
        />
      </div>
    </template>

    <p
      v-if="configError"
      class="rounded-md bg-destructive/10 p-2 text-xs text-destructive"
      data-testid="provider-form-config-error"
    >
      {{ configError }}
    </p>

    <div class="flex items-center justify-end gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-testid="provider-form-cancel"
        @click="onCancel"
      >
        {{ t('common.cancel') }}
      </Button>
      <Button
        type="submit"
        variant="default"
        size="sm"
        :disabled="!canSubmit"
        data-testid="provider-form-save"
      >
        {{ t('common.save') }}
      </Button>
    </div>
  </form>
</template>
