<script setup lang="ts">
// PendingChangesDialog — modal presenting the current draft vs. live
// unified diff and offering a destructive "reset all" action. Fetches
// the patch from GET /api/config/draft/diff and renders it via
// diff2html (lazy-imported to keep the chunk out of the initial bundle).

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/services/ConfirmDialog.vue'
import { endpoints } from '@/api/client'
import { useConfigStore } from '@/stores/config'

interface Props {
  open: boolean
}
const props = defineProps<Props>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { t } = useI18n()
const config = useConfigStore()

const openComputed = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v),
})

const loading = ref(false)
const error = ref<string | null>(null)
const patch = ref<string>('')
const added = ref<number>(0)
const removed = ref<number>(0)
const hasDraft = ref<boolean>(false)
const diffHtml = ref<string | null>(null)

const showConfirm = ref(false)
const resetting = ref(false)

async function renderDiffHtml(raw: string): Promise<string> {
  const { html } = await import('diff2html')
  return html(raw, {
    drawFileList: false,
    matching: 'lines',
    outputFormat: 'line-by-line',
  })
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  diffHtml.value = null
  try {
    const r = await endpoints.config.draftDiff()
    patch.value = r.patch
    added.value = r.added
    removed.value = r.removed
    hasDraft.value = r.hasDraft
    if (r.hasDraft && r.patch.trim().length > 0) {
      diffHtml.value = await renderDiffHtml(r.patch)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('pending_changes.error_generic')
  } finally {
    loading.value = false
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) void load()
    else {
      diffHtml.value = null
      error.value = null
    }
  },
  { immediate: true },
)

function askReset(): void {
  showConfirm.value = true
}

async function confirmReset(): Promise<void> {
  resetting.value = true
  try {
    await config.clearDraft()
    showConfirm.value = false
    emit('update:open', false)
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('pending_changes.error_generic')
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="openComputed">
    <DialogContent class="max-w-5xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <span>{{ t('pending_changes.title') }}</span>
          <Badge v-if="hasDraft" variant="secondary" data-testid="pending-stats">
            +{{ added }} / −{{ removed }}
          </Badge>
        </DialogTitle>
        <DialogDescription v-if="error">
          <span class="text-destructive">{{ t('pending_changes.error_generic') }}</span>
        </DialogDescription>
      </DialogHeader>

      <div
        class="max-h-[60vh] overflow-auto rounded-md border border-border bg-card/40 p-2 text-xs"
      >
        <p v-if="loading" class="py-4 text-center text-muted-foreground">
          {{ t('pending_changes.loading') }}
        </p>
        <div
          v-else-if="error"
          class="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
          <div class="flex-1 space-y-2">
            <p>{{ error }}</p>
            <Button variant="outline" size="sm" data-testid="pending-retry" @click="load">
              {{ t('pending_changes.retry') }}
            </Button>
          </div>
        </div>
        <p v-else-if="!hasDraft" class="py-4 text-center text-muted-foreground">
          {{ t('pending_changes.no_changes') }}
        </p>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-else-if="diffHtml" class="diff-drawer" v-html="diffHtml" />
      </div>

      <DialogFooter>
        <Button
          variant="destructive"
          size="sm"
          data-testid="pending-reset-button"
          :disabled="!hasDraft || loading || resetting"
          @click="askReset"
        >
          {{ t('pending_changes.reset_button') }}
        </Button>
        <Button variant="outline" size="sm" @click="openComputed = false">
          {{ t('pending_changes.close') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <ConfirmDialog
    :open="showConfirm"
    :title="t('pending_changes.reset_confirm_title')"
    :body="t('pending_changes.reset_confirm_body')"
    :confirm-label="t('pending_changes.reset_confirm_action')"
    @update:open="(v: boolean) => (showConfirm = v)"
    @confirm="confirmReset"
  />
</template>

<style scoped>
/* Minimal diff2html CSS subset — same slice used by SnapshotDiffDrawer.vue. */
.diff-drawer :deep(.d2h-wrapper) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.diff-drawer :deep(.d2h-file-header) {
  display: none;
}
.diff-drawer :deep(.d2h-diff-table) {
  width: 100%;
  border-collapse: collapse;
}
.diff-drawer :deep(.d2h-code-linenumber) {
  color: hsl(var(--muted-foreground));
  padding: 0 0.5rem;
}
.diff-drawer :deep(.d2h-code-line) {
  /* See SnapshotDiffDrawer comment: `white-space: nowrap` suppresses the
     literal `\n` between diff2html's prefix and content spans; `-ctn`
     below restores `pre` for real code indentation. */
  white-space: nowrap;
  padding: 0 0.5rem;
}
.diff-drawer :deep(.d2h-code-line-prefix) {
  display: inline;
  white-space: pre;
}
.diff-drawer :deep(.d2h-code-line-ctn) {
  display: inline;
  white-space: pre;
}
.diff-drawer :deep(.d2h-ins) {
  background: rgba(16, 185, 129, 0.15);
}
.diff-drawer :deep(.d2h-del) {
  background: rgba(244, 63, 94, 0.15);
}
.diff-drawer :deep(.d2h-info) {
  color: hsl(var(--muted-foreground));
  background: transparent;
}
.diff-drawer :deep(.d2h-cntx) {
  color: hsl(var(--muted-foreground));
}
</style>
