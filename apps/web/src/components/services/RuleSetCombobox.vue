<script setup lang="ts">
// RuleSetCombobox — type-ahead input backed by the catalog store's
// `ruleProviders` list (v0.2.6). Names come from the live mihomo config's
// top-level `rule-providers:` map (resolveRuleProviders on the server).
//
// Free-form input is always accepted — operators may reference a provider
// that isn't declared yet (the linter will flag orphan RULE-SET targets
// separately). When the catalog is unavailable (read error), the combobox
// degrades to a plain input with an offline hint, same UX as geo-offline.

import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, RefreshCw } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useCatalogStore } from '@/stores/catalog'

interface Props {
  modelValue: string
  placeholder?: string
}
const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  blur: []
}>()

const { t } = useI18n()
const store = useCatalogStore()

const query = ref<string>(props.modelValue)
const dropdownOpen = ref(false)
const activeIndex = ref(0)

onMounted(() => {
  void store.ensureRuleProvidersLoaded()
})

watch(
  () => props.modelValue,
  (v) => {
    if (v !== query.value) query.value = v
  },
)

const errorMessage = computed<string | null>(() => store.error.ruleProviders)

const matches = computed<string[]>(() => {
  if (errorMessage.value) return []
  const q = query.value.trim().toLowerCase()
  if (q.length === 0) return store.ruleProviders.slice(0, 20)
  return store.ruleProviders.filter((v) => v.toLowerCase().includes(q)).slice(0, 20)
})

function onInput(e: Event): void {
  const v = (e.target as HTMLInputElement).value
  query.value = v
  dropdownOpen.value = !errorMessage.value && matches.value.length > 0
  activeIndex.value = 0
  emit('update:modelValue', v)
}

function onBlur(): void {
  dropdownOpen.value = false
  const trimmed = query.value.trim()
  // Keep the input display in lockstep with the emitted model value so
  // a trailing space isn't left visible after the operator tabs away.
  if (trimmed !== query.value) query.value = trimmed
  emit('update:modelValue', trimmed)
  emit('blur')
}

function onFocus(): void {
  if (!errorMessage.value) dropdownOpen.value = true
}

function selectOption(value: string): void {
  query.value = value
  emit('update:modelValue', value)
  dropdownOpen.value = false
}

function onKeyDown(e: KeyboardEvent): void {
  if (errorMessage.value) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (matches.value.length > 0) {
      dropdownOpen.value = true
      activeIndex.value = (activeIndex.value + 1) % matches.value.length
    }
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (matches.value.length > 0) {
      activeIndex.value = (activeIndex.value - 1 + matches.value.length) % matches.value.length
    }
    return
  }
  if (e.key === 'Enter') {
    if (dropdownOpen.value && matches.value.length > 0) {
      e.preventDefault()
      const selected = matches.value[activeIndex.value]
      if (selected !== undefined) selectOption(selected)
    }
    return
  }
  if (e.key === 'Escape') {
    dropdownOpen.value = false
    return
  }
}

async function onRefresh(): Promise<void> {
  await store.refreshRuleProviders()
}
</script>

<template>
  <div class="relative">
    <div class="flex items-center gap-2">
      <div class="relative flex-1">
        <Input
          :model-value="query"
          :placeholder="placeholder ?? t('rule_set_catalog.placeholder')"
          class="h-9 font-mono"
          data-testid="rule-set-combobox-input"
          @input="onInput"
          @blur="onBlur"
          @focus="onFocus"
          @keydown="onKeyDown"
        />
        <Badge
          v-if="errorMessage"
          variant="muted"
          class="absolute right-2 top-1.5 flex items-center gap-1 text-[10px]"
          data-testid="rule-set-offline-badge"
          :title="errorMessage"
        >
          <AlertTriangle class="h-3 w-3" />
          {{ t('rule_set_catalog.offline') }}
        </Badge>
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        class="h-9 w-9"
        :aria-label="t('rule_set_catalog.refresh')"
        :title="t('rule_set_catalog.refresh')"
        data-testid="rule-set-refresh"
        @click="onRefresh"
      >
        <RefreshCw class="h-4 w-4" />
      </Button>
    </div>
    <ul
      v-if="dropdownOpen && matches.length > 0"
      class="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md"
      data-testid="rule-set-dropdown"
    >
      <li
        v-for="(m, i) in matches"
        :key="m"
        data-testid="rule-set-option"
        class="cursor-pointer px-3 py-1 text-sm hover:bg-accent"
        :class="{ 'bg-accent': i === activeIndex }"
        @mousedown.prevent="selectOption(m)"
      >
        {{ m }}
      </li>
    </ul>
    <p v-if="errorMessage" class="mt-1 text-xs text-muted-foreground">
      {{ t('rule_set_catalog.offline_hint') }}
    </p>
  </div>
</template>
