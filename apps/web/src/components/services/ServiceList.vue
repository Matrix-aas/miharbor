<script setup lang="ts">
// ServiceList — left pane of the master-detail Services screen.
//
// Responsibilities:
//   * Search input (debounced 150ms) + direction filter chips.
//   * Render each service as a clickable row with: direction badge,
//     rule-count badge, and an issue-dot (yellow = warnings,
//     red = errors) driven by the linter-populated `service.issues`.
//   * Emit `select` on row click; highlighting follows route params.
//
// Virtual scrolling is intentionally NOT used — MVP assumes <40 services.

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Zap } from 'lucide-vue-next'
import type { Service } from 'miharbor-shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type DirectionFilter = 'all' | 'VPN' | 'DIRECT' | 'REJECT'

interface Props {
  services: Service[]
  selected?: string | null
}
const props = defineProps<Props>()
const emit = defineEmits<{ select: [name: string]; 'add-service': [] }>()

const { t } = useI18n()

const search = ref('')
const filter = ref<DirectionFilter>('all')

// Debounced search term — 150ms per spec. We keep it local to the list so
// other components don't re-render needlessly.
const debouncedSearch = ref('')
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, (v) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    debouncedSearch.value = v.trim().toLowerCase()
  }, 150)
})

const filters: Array<{ key: DirectionFilter; labelKey: string }> = [
  { key: 'all', labelKey: 'services.filter_all' },
  { key: 'VPN', labelKey: 'services.filter_vpn' },
  { key: 'DIRECT', labelKey: 'services.filter_direct' },
  { key: 'REJECT', labelKey: 'services.filter_reject' },
]

const filtered = computed<Service[]>(() => {
  const q = debouncedSearch.value
  return props.services.filter((svc) => {
    if (filter.value !== 'all' && svc.direction !== filter.value) return false
    if (q.length === 0) return true
    return svc.name.toLowerCase().includes(q)
  })
})

function issueSeverity(svc: Service): 'none' | 'warn' | 'error' {
  let hasWarn = false
  for (const iss of svc.issues) {
    if (iss.level === 'error') return 'error'
    if (iss.level === 'warning') hasWarn = true
  }
  return hasWarn ? 'warn' : 'none'
}

function directionVariant(svc: Service): 'default' | 'secondary' | 'destructive' | 'muted' {
  if (svc.direction === 'VPN') return 'default'
  if (svc.direction === 'DIRECT') return 'secondary'
  if (svc.direction === 'REJECT') return 'destructive'
  return 'muted'
}
</script>

<template>
  <aside class="flex h-full w-full flex-col border-r border-border bg-card/30 md:w-80">
    <div class="space-y-3 border-b border-border p-3">
      <Input
        v-model="search"
        :placeholder="t('services.search_placeholder')"
        class="h-9"
        :aria-label="t('common.search')"
      />
      <div class="flex flex-wrap gap-2">
        <Button
          v-for="f in filters"
          :key="f.key"
          size="sm"
          :variant="filter === f.key ? 'default' : 'outline'"
          class="h-7 rounded-full px-3 text-xs"
          @click="filter = f.key"
        >
          {{ t(f.labelKey) }}
        </Button>
      </div>
      <Button variant="outline" size="sm" class="w-full" @click="emit('add-service')">
        <Plus class="h-4 w-4" />
        {{ t('services.add') }}
      </Button>
    </div>

    <ul class="flex-1 overflow-y-auto">
      <li v-for="svc in filtered" :key="svc.name" class="border-b border-border/60">
        <button
          type="button"
          class="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent"
          :class="cn(selected === svc.name ? 'bg-accent' : '')"
          @click="emit('select', svc.name)"
        >
          <Zap class="h-4 w-4 shrink-0 text-primary" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate text-sm font-medium">{{ svc.name }}</span>
              <span
                v-if="issueSeverity(svc) === 'error'"
                class="inline-block h-2 w-2 shrink-0 rounded-full bg-destructive"
                :title="t('services.issues_label')"
                aria-hidden="true"
              />
              <span
                v-else-if="issueSeverity(svc) === 'warn'"
                class="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-500"
                :title="t('services.issues_label')"
                aria-hidden="true"
              />
            </div>
            <p class="text-xs text-muted-foreground">
              {{ t('services.rule_count', { count: svc.rules.length }, svc.rules.length) }}
            </p>
          </div>
          <Badge :variant="directionVariant(svc)" class="shrink-0">
            {{ svc.direction }}
          </Badge>
        </button>
      </li>

      <li v-if="filtered.length === 0" class="px-3 py-8 text-center text-sm text-muted-foreground">
        {{ services.length === 0 ? t('services.none_loaded') : t('services.empty') }}
      </li>
    </ul>
  </aside>
</template>
