<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Home,
  Globe,
  ListChecks,
  Radio,
  Cable,
  Search,
  SlidersHorizontal,
  FileText,
  History,
  Settings,
} from 'lucide-vue-next'
import { cn } from '@/lib/utils'

interface Props {
  collapsed?: boolean
  mobileOpen?: boolean
}
const props = defineProps<Props>()
const emit = defineEmits<{ navigate: [] }>()

const { t } = useI18n()

interface SidebarItem {
  key: string
  to: string
  icon: typeof Home
  available: boolean
}
interface SidebarGroup {
  key: string
  items: SidebarItem[]
}

// MVP scope: /services /proxies /raw-yaml /history /settings. Everything
// else renders disabled with a "stage 2" tooltip per spec §4.
const groups = computed<SidebarGroup[]>(() => [
  {
    key: 'sidebar.routing',
    items: [
      { key: 'sidebar.services', to: '/services', icon: Home, available: true },
      { key: 'sidebar.proxies', to: '/proxies', icon: Globe, available: true },
      { key: 'sidebar.providers', to: '/providers', icon: ListChecks, available: false },
    ],
  },
  {
    key: 'sidebar.infra',
    items: [
      { key: 'sidebar.dns', to: '/dns', icon: Radio, available: false },
      { key: 'sidebar.tun', to: '/tun', icon: Cable, available: false },
      { key: 'sidebar.sniffer', to: '/sniffer', icon: Search, available: false },
      { key: 'sidebar.profile', to: '/profile', icon: SlidersHorizontal, available: false },
    ],
  },
  {
    key: 'sidebar.advanced',
    items: [
      { key: 'sidebar.raw_yaml', to: '/raw-yaml', icon: FileText, available: true },
      { key: 'sidebar.history', to: '/history', icon: History, available: true },
      { key: 'sidebar.settings', to: '/settings', icon: Settings, available: true },
    ],
  },
])

const asideClass = computed(() =>
  cn(
    'flex h-full flex-col border-r border-border bg-card/40 transition-all duration-200',
    // Desktop: collapse/expand width; Mobile: overlay slides from left.
    props.collapsed ? 'w-16' : 'w-60',
    'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-64',
    props.mobileOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full',
  ),
)
</script>

<template>
  <aside :class="asideClass" aria-label="Navigation">
    <nav class="flex-1 overflow-y-auto px-2 py-4">
      <template v-for="group in groups" :key="group.key">
        <p
          v-if="!props.collapsed"
          class="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground first:pt-0"
        >
          {{ t(group.key) }}
        </p>
        <ul class="space-y-1 pb-2">
          <li v-for="item in group.items" :key="item.key">
            <RouterLink
              v-if="item.available"
              :to="item.to"
              class="group flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              active-class="bg-accent text-accent-foreground"
              @click="emit('navigate')"
            >
              <component :is="item.icon" class="h-4 w-4 shrink-0" />
              <span v-if="!props.collapsed">{{ t(item.key) }}</span>
            </RouterLink>
            <span
              v-else
              class="flex cursor-not-allowed items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground/60"
              :title="t('common.stage_2_tooltip')"
            >
              <component :is="item.icon" class="h-4 w-4 shrink-0" />
              <span v-if="!props.collapsed" class="flex-1">{{ t(item.key) }}</span>
              <span
                v-if="!props.collapsed"
                class="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase"
              >
                {{ t('common.soon') }}
              </span>
            </span>
          </li>
        </ul>
      </template>
    </nav>
  </aside>
</template>
