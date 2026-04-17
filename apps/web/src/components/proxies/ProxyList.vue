<script setup lang="ts">
// ProxyList — single-column list of proxy nodes with type/server/port plus
// a live delay badge. Edit button is only active on WireGuard nodes (MVP);
// other transports show it disabled with a "v0.2" tooltip.
//
// Selection / form state lives in the parent page (Proxies.vue).

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Download, Pencil, Plus, Trash2 } from 'lucide-vue-next'
import type { ProxyNode } from 'miharbor-shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import ProxyDelayBadge from './ProxyDelayBadge.vue'

interface Props {
  proxies: ProxyNode[]
}
const props = defineProps<Props>()
const emit = defineEmits<{
  add: []
  import: []
  edit: [name: string]
  delete: [name: string]
}>()

const { t } = useI18n()

const search = ref('')
const debounced = ref('')
let timer: ReturnType<typeof setTimeout> | null = null
watch(search, (v) => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    debounced.value = v.trim().toLowerCase()
  }, 150)
})

const filtered = computed<ProxyNode[]>(() => {
  const q = debounced.value
  if (!q) return props.proxies
  return props.proxies.filter(
    (p) => p.name.toLowerCase().includes(q) || p.server.toLowerCase().includes(q),
  )
})

function typeLabel(type: string): string {
  const key = `proxies.types.${type}`
  const translated = t(key)
  return translated === key ? type : translated
}

function editDisabled(node: ProxyNode): boolean {
  return node.type !== 'wireguard'
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center gap-2">
      <Input v-model="search" :placeholder="t('proxies.search_placeholder')" class="h-9 max-w-xs" />
      <div class="ml-auto flex gap-2">
        <Button variant="outline" size="sm" @click="emit('import')">
          <Download class="h-4 w-4" />
          {{ t('proxies.import') }}
        </Button>
        <Button size="sm" @click="emit('add')">
          <Plus class="h-4 w-4" />
          {{ t('proxies.add_wireguard') }}
        </Button>
      </div>
    </div>

    <div class="rounded-md border border-border">
      <ul class="divide-y divide-border" data-testid="proxy-list">
        <li v-for="p in filtered" :key="p.name" class="flex items-center gap-3 px-3 py-2">
          <Badge variant="outline" class="shrink-0 text-[10px]">{{ typeLabel(p.type) }}</Badge>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ p.name }}</p>
            <p class="truncate font-mono text-xs text-muted-foreground">
              {{ p.server }}:{{ p.port }}
            </p>
          </div>
          <ProxyDelayBadge :name="p.name" />
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8"
            :disabled="editDisabled(p)"
            :title="editDisabled(p) ? t('proxies.edit_disabled') : t('common.edit')"
            :aria-label="t('common.edit')"
            @click="emit('edit', p.name)"
          >
            <Pencil class="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8 text-destructive"
            :aria-label="t('proxies.delete')"
            :title="t('proxies.delete')"
            @click="emit('delete', p.name)"
          >
            <Trash2 class="h-3.5 w-3.5" />
          </Button>
        </li>
        <li
          v-if="filtered.length === 0"
          class="px-3 py-6 text-center text-sm text-muted-foreground"
        >
          {{ t('proxies.empty') }}
        </li>
      </ul>
    </div>
  </div>
</template>
