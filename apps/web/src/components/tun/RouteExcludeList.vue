<script setup lang="ts">
// RouteExcludeList — editable list of CIDRs for `tun.route-exclude-address`
// with live cross-reference against `proxies[].server` IPs.
//
// Each row renders:
//   * a text input for the CIDR / bare IP
//   * a green "proxy IP" badge when the current entry matches a known
//     proxy-server IP (coverage confirmed — self-intercept loop prevented)
//   * a remove button
//
// Above the list we surface a section-level warning listing every proxy
// server IP that is NOT covered by the current exclusion list. The parent
// (Tun.vue) supplies both `proxyServerIps` and the current `modelValue` so
// the logic stays pure — no Pinia reach-through here.

import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Trash2, ShieldCheck } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import GuardrailPlate from '@/components/ui/GuardrailPlate.vue'
import { findMissingRouteExcludes } from 'miharbor-shared'

interface Props {
  modelValue: string[]
  /** Bare IPs (no /32 suffix) of every proxy-server in the current draft. */
  proxyServerIps: readonly string[]
  placeholder?: string
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

/** Does `entry` match any known proxy-server IP? We consider a match when
 *  the entry's bare IP (strip optional CIDR) is in the proxyServerIps set,
 *  OR when the entry is a literal `<ip>/32`. */
function entryMatchesProxy(entry: string): string | null {
  const trimmed = entry.trim()
  if (!trimmed) return null
  const bare = trimmed.replace(/\/\d+$/, '')
  for (const ip of props.proxyServerIps) {
    if (ip === bare || ip === trimmed) return ip
  }
  return null
}

const missingProxyIps = computed<string[]>(() =>
  findMissingRouteExcludes(props.proxyServerIps, items.value),
)
</script>

<template>
  <div class="space-y-3" :aria-label="ariaLabel ?? t('pages.tun.route_exclude.aria_label')">
    <GuardrailPlate
      v-if="missingProxyIps.length > 0"
      :message="t('pages.tun.route_exclude.missing_header')"
      data-testid="route-exclude-missing"
    >
      <span class="block font-medium">
        {{ missingProxyIps.join(', ') }}
      </span>
      <span class="mt-1 block">
        {{ t('pages.tun.route_exclude.missing_hint') }}
      </span>
    </GuardrailPlate>

    <div
      v-for="(item, index) in items"
      :key="index"
      class="flex items-center gap-2"
      data-testid="route-exclude-row"
    >
      <Input
        :model-value="item"
        :placeholder="placeholder ?? t('pages.tun.route_exclude.placeholder')"
        class="h-9 flex-1"
        :aria-label="t('pages.tun.route_exclude.entry_aria', { index: index + 1 })"
        @update:model-value="(v: string | number) => updateAt(index, String(v))"
      />
      <span
        v-if="entryMatchesProxy(item)"
        class="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-xs text-emerald-600 dark:text-emerald-400"
        :title="t('pages.tun.route_exclude.badge_title', { ip: entryMatchesProxy(item) ?? '' })"
        data-testid="route-exclude-badge"
      >
        <ShieldCheck class="h-3 w-3" aria-hidden="true" />
        {{ t('pages.tun.route_exclude.badge') }}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        :aria-label="t('pages.tun.route_exclude.remove')"
        @click="removeAt(index)"
      >
        <Trash2 class="h-4 w-4" />
      </Button>
    </div>

    <p v-if="items.length === 0" class="text-xs text-muted-foreground">
      {{ t('pages.tun.route_exclude.empty') }}
    </p>

    <Button
      type="button"
      variant="outline"
      size="sm"
      data-testid="route-exclude-add"
      @click="addEntry"
    >
      <Plus class="h-4 w-4" />
      {{ t('pages.tun.route_exclude.add') }}
    </Button>
  </div>
</template>
