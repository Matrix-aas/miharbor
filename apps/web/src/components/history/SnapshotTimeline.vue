<script setup lang="ts">
// Timeline list of SnapshotMeta items. Renders newest-first with an
// `applied_by` pill, relative + absolute timestamps, and the +added/-removed
// counts from the diff_summary. Click opens the diff drawer via emit.

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Clock, User, Undo2, RefreshCw, Sparkles } from 'lucide-vue-next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { SnapshotMeta } from '@/api/client'

interface Props {
  snapshots: SnapshotMeta[]
  selectedId?: string | null
  /** Show an absolute timestamp tooltip alongside the relative one. */
  now?: number
}
const props = withDefaults(defineProps<Props>(), { selectedId: null, now: () => Date.now() })
defineEmits<{ open: [id: string]; rollback: [id: string] }>()

const { t } = useI18n()

function iconFor(appliedBy: SnapshotMeta['applied_by']) {
  switch (appliedBy) {
    case 'user':
      return User
    case 'rollback':
    case 'auto-rollback':
      return Undo2
    case 'canonicalization':
      return Sparkles
    default:
      return RefreshCw
  }
}

function variantFor(
  appliedBy: SnapshotMeta['applied_by'],
): 'default' | 'secondary' | 'outline' | 'muted' {
  switch (appliedBy) {
    case 'auto-rollback':
      return 'default'
    case 'rollback':
      return 'secondary'
    case 'canonicalization':
      return 'outline'
    default:
      return 'muted'
  }
}

function relative(ts: string): string {
  const diffMs = props.now - new Date(ts).getTime()
  const s = Math.max(0, Math.floor(diffMs / 1000))
  if (s < 5) return t('history.just_now')
  if (s < 60) return t('history.seconds_ago', { n: s })
  const m = Math.floor(s / 60)
  if (m < 60) return t('history.minutes_ago', { n: m })
  const h = Math.floor(m / 60)
  if (h < 48) return t('history.hours_ago', { n: h })
  const d = Math.floor(h / 24)
  return t('history.days_ago', { n: d })
}

function absolute(ts: string): string {
  return new Date(ts).toLocaleString()
}

const sorted = computed(() =>
  [...props.snapshots].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)),
)
</script>

<template>
  <ol v-if="sorted.length > 0" class="space-y-2">
    <li
      v-for="snap in sorted"
      :key="snap.id"
      class="rounded-md border border-border bg-card/20 p-3 transition hover:bg-card/40"
      :class="{ 'ring-1 ring-primary/60': selectedId === snap.id }"
      :data-testid="`snapshot-${snap.id}`"
    >
      <div class="flex items-center gap-3">
        <div
          class="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <component :is="iconFor(snap.applied_by)" class="h-4 w-4" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <Badge :variant="variantFor(snap.applied_by)">
              {{ t('history.applied_by', { by: snap.applied_by }) }}
            </Badge>
            <span v-if="snap.diff_summary" class="text-xs font-mono">
              <span class="text-emerald-500">+{{ snap.diff_summary.added }}</span>
              <span class="mx-0.5 text-muted-foreground">/</span>
              <span class="text-destructive">-{{ snap.diff_summary.removed }}</span>
            </span>
            <span
              v-if="snap.user_ip"
              class="text-xs text-muted-foreground"
              :title="snap.user_agent ?? ''"
            >
              {{ t('history.ip', { ip: snap.user_ip }) }}
            </span>
          </div>
          <div class="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Clock class="h-3 w-3" />
            <span :title="absolute(snap.timestamp)">{{ relative(snap.timestamp) }}</span>
            <span class="text-[10px] font-mono opacity-70">{{ snap.id }}</span>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <Button variant="outline" size="sm" @click="$emit('open', snap.id)">
            {{ t('history.open') }}
          </Button>
          <Button
            v-if="snap.applied_by !== 'auto-rollback'"
            variant="ghost"
            size="sm"
            :title="t('history.rollback')"
            @click="$emit('rollback', snap.id)"
          >
            <Undo2 class="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </li>
  </ol>
  <div v-else class="py-12 text-center text-sm text-muted-foreground">
    {{ t('history.empty') }}
  </div>
</template>
