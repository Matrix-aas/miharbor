<script setup lang="ts">
// GeoCatalogCombobox — type-ahead input backed by the geo-catalog store.
// Free-form input always allowed; the catalog is a suggestion surface.
// GEOIP type normalises the emitted value to uppercase (match convention).

import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, RefreshCw } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useCatalogStore } from '@/stores/catalog'

interface Props {
  modelValue: string
  type: 'GEOSITE' | 'GEOIP'
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
  void store.ensureLoaded()
})

watch(
  () => props.modelValue,
  (v) => {
    if (v !== query.value) query.value = v
  },
)

const sourceList = computed<string[]>(() => (props.type === 'GEOIP' ? store.geoip : store.geosite))

const errorMessage = computed<string | null>(() =>
  props.type === 'GEOIP' ? store.error.geoip : store.error.geosite,
)

const matches = computed<string[]>(() => {
  if (errorMessage.value) return []
  const q = query.value.trim().toLowerCase()
  if (q.length === 0) return sourceList.value.slice(0, 10)
  return sourceList.value.filter((v) => v.toLowerCase().includes(q)).slice(0, 10)
})

function normalise(v: string): string {
  return props.type === 'GEOIP' ? v.trim().toUpperCase() : v.trim()
}

function onInput(e: Event): void {
  const v = (e.target as HTMLInputElement).value
  query.value = v
  dropdownOpen.value = !errorMessage.value && matches.value.length > 0
  activeIndex.value = 0
  emit('update:modelValue', v) // raw during typing; normalised on blur
}

function onBlur(): void {
  // `@mousedown.prevent` on options keeps the input focused during the click,
  // so we can close the dropdown and emit the normalised value synchronously.
  dropdownOpen.value = false
  emit('update:modelValue', normalise(query.value))
  emit('blur')
}

function onFocus(): void {
  if (!errorMessage.value) dropdownOpen.value = true
}

function selectOption(value: string): void {
  query.value = value
  emit('update:modelValue', normalise(value))
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
  await store.refresh()
}
</script>

<template>
  <div class="relative">
    <div class="flex items-center gap-2">
      <div class="relative flex-1">
        <Input
          :model-value="query"
          :placeholder="placeholder ?? (type === 'GEOIP' ? 'e.g. RU' : 'e.g. youtube')"
          class="h-9 font-mono"
          @input="onInput"
          @blur="onBlur"
          @focus="onFocus"
          @keydown="onKeyDown"
        />
        <Badge
          v-if="errorMessage"
          variant="muted"
          class="absolute right-2 top-1.5 flex items-center gap-1 text-[10px]"
          data-testid="geo-offline-badge"
          :title="errorMessage"
        >
          <AlertTriangle class="h-3 w-3" />
          {{ t('geo_catalog.offline') }}
        </Badge>
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        class="h-9 w-9"
        :aria-label="t('geo_catalog.refresh')"
        :title="t('geo_catalog.refresh')"
        data-testid="geo-refresh"
        @click="onRefresh"
      >
        <RefreshCw class="h-4 w-4" />
      </Button>
    </div>
    <ul
      v-if="dropdownOpen && matches.length > 0"
      class="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md"
    >
      <li
        v-for="(m, i) in matches"
        :key="m"
        data-testid="geo-option"
        class="cursor-pointer px-3 py-1 text-sm hover:bg-accent"
        :class="{ 'bg-accent': i === activeIndex }"
        @mousedown.prevent="selectOption(m)"
      >
        {{ m }}
      </li>
    </ul>
    <p v-if="errorMessage" class="mt-1 text-xs text-muted-foreground">
      {{ t('geo_catalog.offline_hint') }}
    </p>
  </div>
</template>
