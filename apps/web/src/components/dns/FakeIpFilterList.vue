<script setup lang="ts">
// FakeIpFilterList — the mode toggle (blacklist / whitelist) next to the
// list of domain patterns that mihomo skips when assigning fake-IPs.
// Thin wrapper: reuses NameserverList for the list body and pushes the
// mode via a separate `update:mode` emit so the parent can write both
// fields on the DnsConfig at once.

import { useI18n } from 'vue-i18n'
import type { DnsFakeIpFilterMode } from 'miharbor-shared'
import NameserverList from './NameserverList.vue'

interface Props {
  modelValue: string[]
  mode: DnsFakeIpFilterMode
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: string[]]
  'update:mode': [mode: DnsFakeIpFilterMode]
}>()

const { t } = useI18n()

function onModeChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as DnsFakeIpFilterMode
  emit('update:mode', value)
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center gap-2">
      <label class="text-xs font-medium uppercase text-muted-foreground" for="fake-ip-filter-mode">
        {{ t('pages.dns.fields.fake_ip_filter_mode') }}
      </label>
      <select
        id="fake-ip-filter-mode"
        :value="props.mode"
        class="h-9 rounded-md border border-input bg-background px-2 text-sm"
        data-testid="fake-ip-filter-mode-select"
        @change="onModeChange"
      >
        <option value="blacklist">
          {{ t('pages.dns.fake_ip_filter_mode.blacklist') }}
        </option>
        <option value="whitelist">
          {{ t('pages.dns.fake_ip_filter_mode.whitelist') }}
        </option>
      </select>
    </div>
    <NameserverList
      :model-value="props.modelValue"
      :placeholder="t('pages.dns.placeholders.domain_pattern')"
      @update:model-value="(v: string[]) => emit('update:modelValue', v)"
    />
  </div>
</template>
