<script setup lang="ts">
// History — snapshot browser with search, applied_by filter, diff drawer,
// and rollback trigger.
//
// Rollback kicks off the shared deploy pipeline SSE stream via the
// deploy-store `startRollback()` method (Task 26); it opens the Deploy
// Stepper dialog and streams the 6 steps from the server.

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, RefreshCw } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { endpoints, ApiError } from '@/api/client'
import type { SnapshotMeta } from '@/api/client'
import SnapshotTimeline from '@/components/history/SnapshotTimeline.vue'
import SnapshotDiffDrawer from '@/components/history/SnapshotDiffDrawer.vue'
import ConfirmDialog from '@/components/services/ConfirmDialog.vue'
import { useDeployStore } from '@/stores/deploy'

const { t } = useI18n()

type Filter = 'all' | 'user' | 'rollback' | 'auto-rollback' | 'canonicalization'

const snapshots = ref<SnapshotMeta[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const filter = ref<Filter>('all')
const query = ref('')
const drawerOpen = ref(false)
const selectedId = ref<string | null>(null)
const rollbackConfirmId = ref<string | null>(null)

const deploy = useDeployStore()

const filteredSnapshots = computed<SnapshotMeta[]>(() => {
  const q = query.value.trim().toLowerCase()
  return snapshots.value.filter((s) => {
    if (filter.value !== 'all' && s.applied_by !== filter.value) return false
    if (!q) return true
    if (s.id.toLowerCase().includes(q)) return true
    if (s.user_ip?.toLowerCase().includes(q)) return true
    if (s.user_agent?.toLowerCase().includes(q)) return true
    return false
  })
})

const selectedMeta = computed<SnapshotMeta | null>(() => {
  if (!selectedId.value) return null
  return snapshots.value.find((s) => s.id === selectedId.value) ?? null
})

async function loadSnapshots(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    snapshots.value = await endpoints.snapshots.list()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : (e as Error).message
  } finally {
    loading.value = false
  }
}

function onOpenDiff(id: string): void {
  selectedId.value = id
  drawerOpen.value = true
}

function onAskRollback(id: string): void {
  rollbackConfirmId.value = id
}

async function confirmRollback(): Promise<void> {
  if (!rollbackConfirmId.value) return
  const id = rollbackConfirmId.value
  rollbackConfirmId.value = null
  drawerOpen.value = false
  deploy.reset()
  deploy.open()
  try {
    await deploy.startRollback(id)
    // Refresh timeline so the new rollback snapshot shows up.
    await loadSnapshots()
  } catch (e) {
    // Errors surface through DeployStepper — log for debugging.
    console.error('rollback failed', e)
  }
}

onMounted(() => {
  void loadSnapshots()
})

const filterChips: Array<{ value: Filter; key: string }> = [
  { value: 'all', key: 'history.filter_all' },
  { value: 'user', key: 'history.filter_user' },
  { value: 'rollback', key: 'history.filter_rollback' },
  { value: 'auto-rollback', key: 'history.filter_auto_rollback' },
  { value: 'canonicalization', key: 'history.filter_canonicalization' },
]
</script>

<template>
  <section class="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col">
    <header class="space-y-3 border-b border-border px-4 py-3 md:px-6">
      <div class="flex items-center gap-3">
        <h1 class="text-2xl font-semibold tracking-tight">{{ t('history.title') }}</h1>
        <Button
          variant="ghost"
          size="icon"
          :disabled="loading"
          :aria-label="t('common.loading')"
          @click="loadSnapshots"
        >
          <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': loading }" />
        </Button>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <div class="relative max-w-md flex-1">
          <Search class="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input v-model="query" :placeholder="t('history.search_placeholder')" class="pl-8" />
        </div>
        <div class="flex flex-wrap gap-1">
          <Button
            v-for="chip in filterChips"
            :key="chip.value"
            :variant="filter === chip.value ? 'default' : 'outline'"
            size="sm"
            @click="filter = chip.value"
          >
            {{ t(chip.key) }}
          </Button>
        </div>
      </div>
    </header>

    <div class="flex-1 overflow-auto px-4 py-4 md:px-6">
      <p v-if="error" class="mb-3 text-sm text-destructive">{{ error }}</p>
      <p
        v-if="loading && snapshots.length === 0"
        class="py-12 text-center text-sm text-muted-foreground"
      >
        {{ t('history.loading') }}
      </p>
      <SnapshotTimeline
        v-else
        :snapshots="filteredSnapshots"
        :selected-id="selectedId"
        @open="onOpenDiff"
        @rollback="onAskRollback"
      />
    </div>

    <SnapshotDiffDrawer
      v-model:open="drawerOpen"
      :snapshot-id="selectedId"
      :meta="selectedMeta"
      @rollback="onAskRollback"
    />

    <ConfirmDialog
      :open="rollbackConfirmId !== null"
      :title="t('history.rollback_confirm_title')"
      :body="t('history.rollback_confirm_body')"
      :confirm-label="t('history.rollback')"
      @update:open="
        (v: boolean) => {
          if (!v) rollbackConfirmId = null
        }
      "
      @confirm="confirmRollback"
    />
  </section>
</template>
