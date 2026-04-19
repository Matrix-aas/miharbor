<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Menu, Settings as SettingsIcon, Sparkles, X, Zap } from 'lucide-vue-next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConfigStore } from '@/stores/config'
import { useDeployStore } from '@/stores/deploy'
import { setLocale, currentLocale, type AppLocale } from '@/i18n'
import HealthBadge, { type HealthStatus, type CanonicalizedEvent } from './HealthBadge.vue'
import PendingChangesDialog from './PendingChangesDialog.vue'

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

const pendingOpen = ref(false)

// Transport badge — reads meta.transport if the server reports it, falling
// back to "Local" which is the MVP default.
const transportLabel = computed<string>(() => {
  const raw = (config.meta?.transport as string | undefined) ?? 'local'
  if (raw === 'ssh') return t('header.transport_ssh')
  if (raw === 'docker') return t('header.transport_docker')
  return t('header.transport_local')
})

// Hide the "Конфиг v—" badge entirely when neither `version` nor `revision`
// is present on the top-level mihomo config — rendering a dangling dash is
// noise (v0.2.6 item 4, option (a)).
const configVersionLabel = computed<string | null>(() => {
  const version = config.meta?.version ?? config.meta?.revision
  if (version === undefined || version === null || String(version).trim() === '') return null
  return t('header.config_version', { version })
})

const applyTooltip = computed(() =>
  canApply.value ? t('header.apply_tooltip_ready') : t('header.apply_tooltip_empty'),
)

// Canonicalization one-shot banner — raised by HealthBadge when the
// server emits the `canonicalized` event at startup. Dismissed by the
// operator or auto-dismissed on navigation to History.
const canonicalizedPayload = ref<CanonicalizedEvent | null>(null)

function onCanonicalized(ev: CanonicalizedEvent): void {
  canonicalizedPayload.value = ev
}

function dismissCanonicalized(): void {
  canonicalizedPayload.value = null
}

function goToHistoryFromBanner(): void {
  void router.push({ name: 'history' })
  dismissCanonicalized()
}

function onApply(): void {
  if (!canApply.value) return
  deploy.reset()
  deploy.open()
  void deploy.startDeploy()
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
  <div>
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

      <!-- Center: version (only when mihomo's top-level `version`/`revision`
           is actually set — otherwise the badge is dropped entirely, v0.2.6). -->
      <div
        v-if="configVersionLabel"
        class="mx-auto hidden flex-1 items-center justify-center md:flex"
        data-testid="header-config-version"
      >
        <Badge variant="outline">{{ configVersionLabel }}</Badge>
      </div>

      <!-- Right cluster -->
      <div class="ml-auto flex items-center gap-3">
        <HealthBadge
          class="hidden sm:flex"
          :status="healthStatus"
          @canonicalized="onCanonicalized"
        />

        <button
          v-if="canApply"
          type="button"
          data-testid="header-pending-badge"
          :title="t('header.pending_tooltip')"
          class="rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="pendingOpen = true"
        >
          <Badge variant="secondary">{{ t('header.pending_changes') }}</Badge>
        </button>
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

    <div
      v-if="canonicalizedPayload"
      class="flex items-center gap-3 border-b border-border bg-amber-950/40 px-4 py-2 text-sm text-amber-200"
    >
      <Sparkles class="h-4 w-4 flex-shrink-0" />
      <button
        class="flex-1 text-left underline-offset-2 hover:underline"
        @click="goToHistoryFromBanner"
      >
        {{ t('deploy_live.health_canonicalized_banner') }}
      </button>
      <Button
        variant="ghost"
        size="icon"
        :aria-label="t('deploy_live.dismiss')"
        @click="dismissCanonicalized"
      >
        <X class="h-4 w-4" />
      </Button>
    </div>

    <PendingChangesDialog v-model:open="pendingOpen" />
  </div>
</template>
