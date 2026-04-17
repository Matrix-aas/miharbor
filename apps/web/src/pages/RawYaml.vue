<script setup lang="ts">
// Raw YAML page — Tasks 23 (view) + 39 (edit).
//
// Two modes:
//   * view (default, Stage-1 behaviour): MonacoYamlView, read-only.
//   * edit (Stage-2, gated by a toggle): MonacoYamlEdit with parse-error
//     markers from the store's `draftParseError` computed. Changes flow
//     through `config.applyRawYaml(text)` which updates the draft locally
//     *and* (if valid YAML) PUTs to the server.
//
// Dirty state & Apply button:
//   * The editor holds `localText` — the current Monaco buffer.
//   * `isDirty` is `localText !== config.draftText` (i.e. there's an
//     unsaved edit).
//   * Apply button calls `applyRawYaml(localText)`. If parse fails, the
//     store keeps the invalid text in `draftText` (so structural routes
//     block) but does NOT PUT; the button stays enabled so the operator
//     can fix + retry.
//   * Leaving edit mode with dirty state prompts for discard.

import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Check, Copy, Eye, Pencil } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useConfigStore } from '@/stores/config'

// Both wrappers are lazy-loaded — Monaco is ~2.3MB raw, we keep it out of
// the main chunk. defineAsyncComponent + dynamic `import()` means Vite
// emits them as separate chunks inside the Raw YAML route's bundle.
const MonacoYamlView = defineAsyncComponent(() => import('@/components/yaml/MonacoYamlView.vue'))
const MonacoYamlEdit = defineAsyncComponent(() => import('@/components/yaml/MonacoYamlEdit.vue'))

const { t } = useI18n()
const config = useConfigStore()

type Mode = 'view' | 'edit'
const mode = ref<Mode>('view')

/** Backing buffer for edit mode. We seed it from `draftText || rawLive` on
 *  enter-edit and overwrite on exit so the editor doesn't keep stale data. */
const localText = ref<string>('')
/** Snapshot of what was committed the last time we applied (or entered edit
 *  mode). Comparing to this gives a stable "is there unsaved work?" flag —
 *  we can't compare to `config.draftText` because we mirror every keystroke
 *  into the store so `draftValid` can recompute (which in turn gates the
 *  structural-route banner). */
const baseline = ref<string>('')
const applying = ref(false)
const applyError = ref<string | null>(null)

const viewText = computed(() => config.draftText ?? config.rawLive ?? '')
const isDirty = computed(() => mode.value === 'edit' && localText.value !== baseline.value)
const canApply = computed(() => isDirty.value && config.draftValid && !applying.value)

const parseError = computed(() => config.draftParseError)

function enterEdit(): void {
  const seed = config.draftText ?? config.rawLive ?? ''
  localText.value = seed
  baseline.value = seed
  applyError.value = null
  mode.value = 'edit'
}

function exitEdit(): void {
  // Guard unsaved edits — the structural-route banner makes it hard to leave
  // the draft in a half-saved state, so we force an explicit confirmation.
  if (isDirty.value) {
    const confirmed = window.confirm(t('raw_yaml.discard_confirm'))
    if (!confirmed) return
    // Discard: re-apply the last-known-good draft (or rawLive if no draft).
    localText.value = config.draftText ?? config.rawLive ?? ''
  }
  applyError.value = null
  mode.value = 'view'
}

function onEditorInput(next: string): void {
  localText.value = next
  // Keep `draftText` in sync so `draftParseError` / `draftValid` update in
  // real time — that drives the invalid-YAML banner on structural routes.
  config.draftText = next
}

async function applyChanges(): Promise<void> {
  applying.value = true
  applyError.value = null
  try {
    const ok = await config.applyRawYaml(localText.value)
    if (ok) {
      // Successful PUT — update the baseline so the dirty flag clears.
      baseline.value = localText.value
    } else {
      applyError.value = config.draftParseError?.message ?? t('raw_yaml.parse_error_generic')
    }
  } catch (e) {
    applyError.value = e instanceof Error ? e.message : String(e)
  } finally {
    applying.value = false
  }
}

const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
async function copyToClipboard(): Promise<void> {
  const text = mode.value === 'edit' ? localText.value : viewText.value
  try {
    await navigator.clipboard.writeText(text)
    copyState.value = 'copied'
  } catch {
    copyState.value = 'failed'
  }
  setTimeout(() => {
    copyState.value = 'idle'
  }, 1500)
}

onMounted(() => {
  // Same guard as view-only mode: if the user deep-links here we need to
  // hydrate the store before Monaco tries to render.
  if (!config.draftText && !config.rawLive) {
    void config.loadAll()
  }
})

// If the remote draft moves while we're in view mode (another tab, Apply
// elsewhere), pick up the change. In edit mode we intentionally don't
// overwrite — the operator's buffer wins until they apply or discard.
watch(
  () => config.draftText,
  (next) => {
    if (mode.value === 'view' && next && next !== localText.value) {
      localText.value = next
    }
  },
)
</script>

<template>
  <section class="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col">
    <header class="flex items-center gap-3 border-b border-border px-4 py-3 md:px-6">
      <h1 class="text-xl font-semibold tracking-tight">{{ t('pages.raw_yaml.title') }}</h1>

      <!-- Mode switcher -->
      <div class="ml-2 flex items-center gap-1 rounded-md border border-border bg-muted p-0.5">
        <button
          type="button"
          data-testid="raw-yaml-mode-view"
          class="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors"
          :class="
            mode === 'view'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          "
          @click="exitEdit"
        >
          <Eye class="h-3 w-3" />
          <span>{{ t('raw_yaml.mode_view') }}</span>
        </button>
        <button
          type="button"
          data-testid="raw-yaml-mode-edit"
          class="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors"
          :class="
            mode === 'edit'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          "
          @click="enterEdit"
        >
          <Pencil class="h-3 w-3" />
          <span>{{ t('raw_yaml.mode_edit') }}</span>
        </button>
      </div>

      <Badge v-if="mode === 'view'" variant="muted">{{ t('raw_yaml.read_only') }}</Badge>
      <Badge v-else-if="isDirty" variant="default" data-testid="raw-yaml-dirty-badge">
        {{ t('raw_yaml.dirty') }}
      </Badge>

      <div class="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" :disabled="!viewText" @click="copyToClipboard">
          <Copy v-if="copyState === 'idle'" class="mr-1.5 h-3.5 w-3.5" />
          <Check v-else-if="copyState === 'copied'" class="mr-1.5 h-3.5 w-3.5 text-emerald-500" />
          <Copy v-else class="mr-1.5 h-3.5 w-3.5 text-destructive" />
          <span v-if="copyState === 'copied'">{{ t('raw_yaml.copied') }}</span>
          <span v-else-if="copyState === 'failed'">{{ t('raw_yaml.copy_failed') }}</span>
          <span v-else>{{ t('raw_yaml.copy') }}</span>
        </Button>
        <Button
          v-if="mode === 'edit'"
          size="sm"
          :disabled="!canApply"
          data-testid="raw-yaml-apply"
          @click="applyChanges"
        >
          {{ applying ? t('common.loading') : t('raw_yaml.apply') }}
        </Button>
      </div>
    </header>

    <!-- Parse-error banner: visible only in edit mode when draft fails to
         parse. Complements the inline Monaco markers. -->
    <div
      v-if="mode === 'edit' && parseError"
      data-testid="raw-yaml-parse-error"
      class="flex items-start gap-2 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive md:px-6"
      role="alert"
    >
      <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
      <div class="flex-1">
        <p class="font-medium">{{ t('raw_yaml.parse_error_title') }}</p>
        <p class="mt-0.5 font-mono text-xs opacity-90">
          <span v-if="parseError.line">
            {{
              t('raw_yaml.parse_error_line', { line: parseError.line, col: parseError.col ?? 1 })
            }}
          </span>
          {{ parseError.message }}
        </p>
      </div>
    </div>

    <div
      v-if="applyError"
      data-testid="raw-yaml-apply-error"
      class="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive md:px-6"
      role="alert"
    >
      {{ applyError }}
    </div>

    <p v-if="!viewText && mode === 'view'" class="px-4 py-6 text-sm text-muted-foreground md:px-6">
      {{ t('common.loading') }}
    </p>

    <div v-else class="flex-1 min-h-0">
      <MonacoYamlView v-if="mode === 'view'" :model-value="viewText" read-only language="yaml" />
      <MonacoYamlEdit
        v-else
        :model-value="localText"
        :parse-error="parseError"
        @update:model-value="onEditorInput"
      />
    </div>
  </section>
</template>
