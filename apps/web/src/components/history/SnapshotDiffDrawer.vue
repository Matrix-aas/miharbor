<script setup lang="ts">
// Diff drawer for a selected snapshot. Fetches the masked config and the
// pre-computed diff.patch from /api/snapshots/:id, then renders the diff
// via diff2html (tight HTML output, red/green inline).
//
// The drawer doubles as the Rollback confirmation surface: an explicit
// "Rollback to this snapshot" button sits in the footer.

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { endpoints } from '@/api/client'
import type { SnapshotDetail, SnapshotMeta } from '@/api/client'

interface Props {
  open: boolean
  snapshotId: string | null
  /** Preloaded meta (so we can render header even before detail fetch resolves). */
  meta?: SnapshotMeta | null
}
const props = defineProps<Props>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  rollback: [id: string]
}>()

const { t } = useI18n()

const detail = ref<SnapshotDetail | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
/** Rendered diff HTML — lazy-built via diff2html on drawer open. */
const diffHtml = ref<string | null>(null)

const openComputed = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v),
})

async function renderDiffHtml(patch: string): Promise<string> {
  // Lazy-load diff2html — it's a ~40KB chunk on its own; we don't want to
  // pull it into the main bundle.
  const { html } = await import('diff2html')
  return html(patch, {
    drawFileList: false,
    matching: 'lines',
    outputFormat: 'line-by-line',
  })
}

watch(
  () => props.snapshotId,
  async (id) => {
    detail.value = null
    diffHtml.value = null
    error.value = null
    if (!id || !props.open) return
    loading.value = true
    try {
      const d = await endpoints.snapshots.get(id)
      detail.value = d
      // If the server returned the pre-computed diff.patch, render it
      // directly. Otherwise fall back to a synthetic context-only diff of
      // the masked config (still shows what the snapshot contains even if
      // we can't show the delta — e.g. first snapshot).
      const patch =
        typeof d.diffPatch === 'string' && d.diffPatch.trim().length > 0
          ? d.diffPatch
          : buildSyntheticDiff(d.configMasked, id)
      diffHtml.value = await renderDiffHtml(patch)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      // Clear state so the next open starts fresh.
      detail.value = null
      diffHtml.value = null
      error.value = null
    }
  },
)

/** When the server only returns `configMasked`, synthesize a diff-like
 *  single-file patch so diff2html has something to render. Each line is
 *  shown as context (no +/-). This is a stop-gap until the server exposes
 *  the pre-computed diff.patch in the /:id JSON response. */
function buildSyntheticDiff(configMasked: string, snapshotId: string): string {
  const header = [
    `--- previous`,
    `+++ snapshot ${snapshotId}`,
    `@@ -0,0 +${configMasked.split('\n').length} @@`,
  ].join('\n')
  const body = configMasked
    .split('\n')
    .map((line) => ` ${line}`)
    .join('\n')
  return `${header}\n${body}\n`
}

function requestRollback(): void {
  if (props.snapshotId) emit('rollback', props.snapshotId)
}
</script>

<template>
  <Dialog v-model:open="openComputed">
    <DialogContent class="max-w-5xl">
      <DialogHeader>
        <DialogTitle>{{ t('history.diff_title') }}</DialogTitle>
        <DialogDescription v-if="meta">
          <Badge variant="outline" class="mr-2">{{
            t('history.applied_by', { by: meta.applied_by })
          }}</Badge>
          <span class="text-xs font-mono">{{ meta.id }}</span>
        </DialogDescription>
      </DialogHeader>

      <div
        class="max-h-[60vh] overflow-auto rounded-md border border-border bg-card/40 p-2 text-xs"
      >
        <p v-if="loading" class="py-4 text-center text-muted-foreground">
          {{ t('common.loading') }}
        </p>
        <p v-else-if="error" class="py-4 text-center text-destructive">{{ error }}</p>
        <p v-else-if="!diffHtml" class="py-4 text-center text-muted-foreground">
          {{ t('history.diff_empty') }}
        </p>
        <!-- diff2html escapes its output; we trust the server-produced diff.patch -->
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-else class="diff-drawer" v-html="diffHtml"></div>
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" @click="openComputed = false">
          {{ t('history.drawer_close') }}
        </Button>
        <Button
          v-if="meta && meta.applied_by !== 'auto-rollback'"
          variant="default"
          size="sm"
          @click="requestRollback"
        >
          {{ t('history.rollback') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style>
/* diff2html ships its own CSS; import the minimal subset inline so we
   don't add another global stylesheet. Values copied from diff2html's
   `diff2html.css` — trimmed to line-by-line view only. */
.diff-drawer .d2h-wrapper {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.diff-drawer .d2h-file-header {
  display: none; /* we render header ourselves */
}
.diff-drawer .d2h-diff-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.diff-drawer .d2h-code-linenumber {
  width: 50px;
  color: hsl(var(--muted-foreground));
  padding: 0 8px;
  text-align: right;
  user-select: none;
}
.diff-drawer .d2h-code-line {
  white-space: pre;
  padding: 0 4px;
}
.diff-drawer .d2h-ins {
  background: rgba(16, 185, 129, 0.18);
  color: rgb(209, 250, 229);
}
.diff-drawer .d2h-del {
  background: rgba(239, 68, 68, 0.18);
  color: rgb(254, 226, 226);
}
.diff-drawer .d2h-info {
  background: rgba(99, 102, 241, 0.18);
  color: rgb(199, 210, 254);
}
.diff-drawer .d2h-cntx {
  color: hsl(var(--muted-foreground));
}
</style>
