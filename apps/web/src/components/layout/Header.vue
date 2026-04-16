<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Menu, Settings as SettingsIcon, Zap } from 'lucide-vue-next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConfigStore } from '@/stores/config'
import { useDeployStore } from '@/stores/deploy'
import { setLocale, currentLocale, type AppLocale } from '@/i18n'
import HealthBadge, { type HealthStatus } from './HealthBadge.vue'

interface Props {
  collapsed?: boolean
  healthStatus?: HealthStatus
}
defineProps<Props>()
const emit = defineEmits<{ toggleSidebar: []; toggleMobile: [] }>()

const { t, locale } = useI18n()
const config = useConfigStore()
const deploy = useDeployStore()
const router = useRouter()

const dirtyCount = computed(() => config.dirtyCount)
const canApply = computed(() => dirtyCount.value > 0)

// Transport badge — reads meta.transport if the server reports it, falling
// back to "Local" which is the MVP default.
const transportLabel = computed<string>(() => {
  const raw = (config.meta?.transport as string | undefined) ?? 'local'
  if (raw === 'ssh') return t('header.transport_ssh')
  if (raw === 'docker') return t('header.transport_docker')
  return t('header.transport_local')
})

const configVersion = computed<string>(() => {
  const version = config.meta?.version ?? config.meta?.revision ?? '—'
  return t('header.config_version', { version })
})

const applyTooltip = computed(() =>
  canApply.value ? t('header.apply_tooltip_ready') : t('header.apply_tooltip_empty'),
)

function onApply(): void {
  if (!canApply.value) return
  deploy.reset()
  deploy.open()
}

function toggleLocale(): void {
  const next: AppLocale = currentLocale() === 'en' ? 'ru' : 'en'
  setLocale(next)
  locale.value = next
}

function openSettings(): void {
  void router.push({ name: 'settings' })
}
</script>

<template>
  <header
    class="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background px-4"
  >
    <!-- Mobile hamburger -->
    <Button
      variant="ghost"
      size="icon"
      class="md:hidden"
      :aria-label="t('sidebar.toggle')"
      @click="emit('toggleMobile')"
    >
      <Menu class="h-5 w-5" />
    </Button>

    <!-- Desktop collapse button -->
    <Button
      variant="ghost"
      size="icon"
      class="hidden md:inline-flex"
      :aria-label="t('sidebar.toggle')"
      @click="emit('toggleSidebar')"
    >
      <Menu class="h-5 w-5" />
    </Button>

    <!-- Logo + tagline -->
    <div class="flex items-center gap-2">
      <Zap class="h-5 w-5 text-primary" />
      <span class="text-base font-semibold tracking-tight">{{ t('app.title') }}</span>
      <Badge variant="muted">{{ transportLabel }}</Badge>
    </div>

    <!-- Center: version -->
    <div class="mx-auto hidden flex-1 items-center justify-center md:flex">
      <Badge variant="outline">{{ configVersion }}</Badge>
    </div>

    <!-- Right cluster -->
    <div class="ml-auto flex items-center gap-3">
      <HealthBadge class="hidden sm:flex" :status="healthStatus" />

      <Badge v-if="canApply" variant="secondary" :title="t('header.apply_tooltip_ready')">
        {{ t('header.changes_count', { count: dirtyCount }, dirtyCount) }}
      </Badge>
      <Badge v-else variant="muted">{{ t('header.no_changes') }}</Badge>

      <Button
        variant="default"
        size="sm"
        :disabled="!canApply"
        :title="applyTooltip"
        @click="onApply"
      >
        {{ t('header.apply') }}
      </Button>

      <Button
        variant="outline"
        size="sm"
        :aria-label="t('header.language')"
        :title="t('header.language')"
        @click="toggleLocale"
      >
        {{ currentLocale() === 'ru' ? 'RU' : 'EN' }}
      </Button>

      <Button
        variant="ghost"
        size="icon"
        :aria-label="t('header.settings')"
        :title="t('header.settings')"
        @click="openSettings"
      >
        <SettingsIcon class="h-4 w-4" />
      </Button>
    </div>
  </header>
</template>
