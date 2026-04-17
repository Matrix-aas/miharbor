<script setup lang="ts">
// Providers page — structured editor for the `rule-providers:` section.
// Same data-flow pattern as Dns.vue / Tun.vue / Sniffer.vue / Profile.vue:
//   1. configStore.loadAll() pulls the draft on mount.
//   2. `configStore.providersConfig` derives the typed view from the draft
//      Document via the client mirror of the server projection.
//   3. ProviderForm emits a full {name, config} payload on submit; we merge
//      into the providers map and call `setProvidersConfigDraft`.
//   4. The mutator writes the `rule-providers:` YAML, PUTs the draft, and
//      the lint pipeline kicks off.
//   5. Per-provider refresh calls the server's POST /api/providers/:name/
//      refresh which proxies to mihomo's PUT /providers/rules/:name.
//
// Unknown/extras: malformed entries round-trip via the top-level `extras`
// bag on RuleProvidersConfig so the operator never loses data. The table
// shows them in a separate read-only footer so they're visible but not
// actionable from the UI (Raw YAML is the escape hatch).

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, X } from 'lucide-vue-next'
import type { RuleProviderConfig, RuleProvidersConfig } from 'miharbor-shared'
import { useConfigStore } from '@/stores/config'
import { endpoints, ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import ProviderList, { type LiveProviderState } from '@/components/providers/ProviderList.vue'
import ProviderForm from '@/components/providers/ProviderForm.vue'

const { t } = useI18n()
const config = useConfigStore()

// ----- page state --------------------------------------------------------

type FormMode = { kind: 'none' } | { kind: 'add' } | { kind: 'edit'; name: string }
const formMode = ref<FormMode>({ kind: 'none' })
const refreshingName = ref<string | null>(null)
const toast = ref<{ kind: 'ok' | 'err'; message: string } | null>(null)
const liveState = ref<Record<string, LiveProviderState>>({})

onMounted(async () => {
  await config.loadAll()
  void refreshLiveState()
})

const providers = computed<RuleProvidersConfig>(() => config.providersConfig)
const providersMap = computed<Record<string, RuleProviderConfig>>(
  () => providers.value.providers ?? {},
)
const existingNames = computed<string[]>(() => Object.keys(providersMap.value))

const extrasKeys = computed<string[]>(() => Object.keys(providers.value.extras ?? {}))

// ----- live state from mihomo /providers/rules ---------------------------

/** Best-effort poll of mihomo's /providers/rules so the list can show
 *  last-updated timestamps and an "updating" badge. Failures are silently
 *  swallowed — the list still renders fine without live state. */
async function refreshLiveState(): Promise<void> {
  try {
    const raw = await fetch('/api/mihomo/providers/rules', { credentials: 'include' })
    if (!raw.ok) return
    const body = (await raw.json()) as { providers?: Record<string, unknown> }
    const out: Record<string, LiveProviderState> = {}
    const src = body.providers ?? body
    if (src && typeof src === 'object') {
      for (const [name, info] of Object.entries(src)) {
        if (!info || typeof info !== 'object') continue
        const r = info as Record<string, unknown>
        const entry: LiveProviderState = {}
        if (typeof r.updatedAt === 'string') entry.updatedAt = r.updatedAt
        if (typeof r.updating === 'boolean') entry.updating = r.updating
        if (typeof r.ruleCount === 'number') entry.ruleCount = r.ruleCount
        out[name] = entry
      }
    }
    liveState.value = out
  } catch {
    // mihomo may be down; leave liveState as-is.
  }
}

// ----- mutations --------------------------------------------------------

function onAdd(): void {
  formMode.value = { kind: 'add' }
}

function onEdit(name: string): void {
  formMode.value = { kind: 'edit', name }
}

function onCancelForm(): void {
  formMode.value = { kind: 'none' }
}

async function onSubmitForm(payload: { name: string; config: RuleProviderConfig }): Promise<void> {
  const current = providers.value
  const nextProviders = { ...(current.providers ?? {}) }
  // In edit mode, replace under the existing key so insertion order is
  // preserved (we don't delete+add which would move it to the end).
  if (formMode.value.kind === 'edit') {
    nextProviders[formMode.value.name] = payload.config
  } else {
    nextProviders[payload.name] = payload.config
  }
  const next: RuleProvidersConfig = { ...current, providers: nextProviders }
  try {
    await config.setProvidersConfigDraft(next)
    formMode.value = { kind: 'none' }
  } catch (e) {
    toast.value = {
      kind: 'err',
      message: e instanceof Error ? e.message : String(e),
    }
  }
}

async function onRemove(name: string): Promise<void> {
  const current = providers.value
  const nextProviders = { ...(current.providers ?? {}) }
  delete nextProviders[name]
  const next: RuleProvidersConfig = { ...current }
  if (Object.keys(nextProviders).length > 0) next.providers = nextProviders
  else delete next.providers
  try {
    await config.setProvidersConfigDraft(next)
  } catch (e) {
    toast.value = {
      kind: 'err',
      message: e instanceof Error ? e.message : String(e),
    }
  }
}

async function onRefresh(name: string): Promise<void> {
  refreshingName.value = name
  try {
    await endpoints.providers.refresh(name)
    toast.value = { kind: 'ok', message: t('pages.providers.toast.refresh_ok', { name }) }
    // Give mihomo a beat to flip the updating flag back, then re-poll.
    setTimeout(() => {
      void refreshLiveState()
    }, 500)
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : (e as Error).message
    toast.value = { kind: 'err', message: t('pages.providers.toast.refresh_err', { name, msg }) }
  } finally {
    refreshingName.value = null
  }
}

function dismissToast(): void {
  toast.value = null
}

const formInitial = computed<{ name: string; cfg: RuleProviderConfig }>(() => {
  if (formMode.value.kind === 'edit') {
    const name = formMode.value.name
    const cfg = providersMap.value[name] ?? { type: 'http', behavior: 'classical' }
    return { name, cfg }
  }
  return {
    name: '',
    cfg: { type: 'http', behavior: 'classical', format: 'yaml' },
  }
})
</script>

<template>
  <section class="space-y-6" data-testid="providers-page">
    <header class="flex items-start justify-between gap-4">
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold tracking-tight">{{ t('pages.providers.title') }}</h1>
        <p class="text-sm text-muted-foreground">{{ t('pages.providers.subtitle') }}</p>
      </div>
      <Button
        v-if="formMode.kind === 'none'"
        type="button"
        variant="default"
        size="sm"
        data-testid="providers-add"
        @click="onAdd"
      >
        <Plus class="h-4 w-4" />
        {{ t('pages.providers.add') }}
      </Button>
    </header>

    <!-- Toast banner -->
    <div
      v-if="toast"
      class="flex items-center justify-between rounded-md px-3 py-2 text-sm"
      :class="
        toast.kind === 'ok'
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'bg-destructive/10 text-destructive'
      "
      role="status"
      aria-live="polite"
      data-testid="providers-toast"
    >
      <span>{{ toast.message }}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        :aria-label="t('common.close')"
        @click="dismissToast"
      >
        <X class="h-4 w-4" />
      </Button>
    </div>

    <!-- Add / Edit form -->
    <section
      v-if="formMode.kind !== 'none'"
      class="space-y-3 rounded-md border border-border bg-card/30 p-4"
      data-testid="providers-form-card"
    >
      <h2 class="text-lg font-semibold">
        {{
          formMode.kind === 'edit'
            ? t('pages.providers.form.edit_title', { name: formInitial.name })
            : t('pages.providers.form.add_title')
        }}
      </h2>
      <ProviderForm
        :model-value="formInitial.cfg"
        :name="formInitial.name"
        :existing-names="existingNames"
        :is-edit="formMode.kind === 'edit'"
        @submit="onSubmitForm"
        @cancel="onCancelForm"
      />
    </section>

    <!-- Table -->
    <section class="space-y-3 rounded-md border border-border bg-card/30 p-4">
      <h2 class="text-lg font-semibold">{{ t('pages.providers.list.title') }}</h2>
      <ProviderList
        :providers="providersMap"
        :live-state="liveState"
        :refreshing-name="refreshingName"
        @edit="onEdit"
        @remove="onRemove"
        @refresh="onRefresh"
      />
    </section>

    <!-- Extras (malformed entries preserved verbatim) -->
    <section
      v-if="extrasKeys.length > 0"
      class="space-y-2 rounded-md border border-dashed border-border bg-card/20 p-4"
      data-testid="providers-extras"
    >
      <h2 class="text-sm font-medium uppercase text-muted-foreground">
        {{ t('pages.providers.extras.title') }}
      </h2>
      <p class="text-xs text-muted-foreground">{{ t('pages.providers.extras.note') }}</p>
      <ul class="text-xs font-mono">
        <li v-for="k in extrasKeys" :key="k">{{ k }}</li>
      </ul>
    </section>
  </section>
</template>
