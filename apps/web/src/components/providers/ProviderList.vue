<script setup lang="ts">
// ProviderList — read-only table of configured rule-providers with
// per-row edit / delete / refresh actions. The Providers.vue page owns
// the add / edit form and wires refresh through the API client.
//
// Shape contract:
//   providers          → Record<name, RuleProviderConfig> (insertion
//                        order preserved by the store's projection)
//   liveState          → optional Record<name, LiveProviderState>; filled
//                        from mihomo /providers/rules when available. An
//                        offline mihomo renders empty live-state without
//                        breaking the list.

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Pencil, RefreshCcw, Trash2 } from 'lucide-vue-next'
import type { RuleProviderConfig } from 'miharbor-shared'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export interface LiveProviderState {
  /** Last update timestamp from mihomo (ISO string). */
  updatedAt?: string
  /** True while mihomo is refreshing this provider. */
  updating?: boolean
  /** Number of rules the provider loaded. */
  ruleCount?: number
}

interface Props {
  providers: Record<string, RuleProviderConfig>
  liveState?: Record<string, LiveProviderState>
  /** Name currently being refreshed — renders a disabled/busy state on its row. */
  refreshingName?: string | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  edit: [name: string]
  remove: [name: string]
  refresh: [name: string]
}>()

const { t } = useI18n()

// Insertion order: Object.entries preserves the order the `yaml` parser
// and our mutator write keys in. We don't sort here.
const entries = computed<Array<{ name: string; cfg: RuleProviderConfig }>>(() =>
  Object.entries(props.providers).map(([name, cfg]) => ({ name, cfg })),
)

function lastUpdated(name: string): string {
  const s = props.liveState?.[name]
  if (!s || !s.updatedAt) return t('pages.providers.list.never_updated')
  return formatIsoTimestamp(s.updatedAt)
}

function isRefreshable(cfg: RuleProviderConfig): boolean {
  return cfg.type === 'http' || cfg.type === 'file'
}

/** ISO-8601 → localised short date-time. Falls back to the raw string
 *  if Intl can't parse it. */
function formatIsoTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}
</script>

<template>
  <div class="space-y-2" data-testid="provider-list">
    <p v-if="entries.length === 0" class="text-sm text-muted-foreground">
      {{ t('pages.providers.list.empty') }}
    </p>
    <table
      v-else
      class="w-full table-auto border-collapse text-sm"
      :aria-label="t('pages.providers.list.table_aria')"
    >
      <thead>
        <tr class="border-b border-border text-left text-xs uppercase text-muted-foreground">
          <th class="py-2 pr-3">{{ t('pages.providers.list.col_name') }}</th>
          <th class="py-2 pr-3">{{ t('pages.providers.list.col_type') }}</th>
          <th class="py-2 pr-3">{{ t('pages.providers.list.col_behavior') }}</th>
          <th class="py-2 pr-3">{{ t('pages.providers.list.col_format') }}</th>
          <th class="py-2 pr-3">{{ t('pages.providers.list.col_interval') }}</th>
          <th class="py-2 pr-3">{{ t('pages.providers.list.col_updated') }}</th>
          <th class="py-2 text-right">{{ t('pages.providers.list.col_actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="{ name, cfg } in entries"
          :key="name"
          class="border-b border-border/50"
          :data-testid="`provider-row-${name}`"
        >
          <td class="py-2 pr-3 font-mono text-xs">
            {{ name }}
            <Badge
              v-if="liveState?.[name]?.updating"
              variant="secondary"
              class="ml-1"
              data-testid="provider-updating-badge"
            >
              {{ t('pages.providers.list.updating') }}
            </Badge>
          </td>
          <td class="py-2 pr-3">
            <Badge :variant="cfg.type === 'inline' ? 'secondary' : 'outline'">{{ cfg.type }}</Badge>
          </td>
          <td class="py-2 pr-3 text-xs text-muted-foreground">{{ cfg.behavior }}</td>
          <td class="py-2 pr-3 text-xs text-muted-foreground">{{ cfg.format ?? '—' }}</td>
          <td class="py-2 pr-3 text-xs text-muted-foreground">
            {{ cfg.interval !== undefined ? cfg.interval : '—' }}
          </td>
          <td class="py-2 pr-3 text-xs text-muted-foreground">{{ lastUpdated(name) }}</td>
          <td class="py-2 text-right">
            <div class="flex justify-end gap-1">
              <Button
                v-if="isRefreshable(cfg)"
                type="button"
                variant="ghost"
                size="sm"
                :disabled="refreshingName === name"
                :aria-label="t('pages.providers.list.refresh', { name })"
                :data-testid="`provider-refresh-${name}`"
                @click="emit('refresh', name)"
              >
                <RefreshCcw
                  class="h-4 w-4"
                  :class="refreshingName === name ? 'animate-spin' : ''"
                />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                :aria-label="t('pages.providers.list.edit', { name })"
                :data-testid="`provider-edit-${name}`"
                @click="emit('edit', name)"
              >
                <Pencil class="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                :aria-label="t('pages.providers.list.delete', { name })"
                :data-testid="`provider-delete-${name}`"
                @click="emit('remove', name)"
              >
                <Trash2 class="h-4 w-4" />
              </Button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
