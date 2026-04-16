<script setup lang="ts">
// Compact mihomo-up/down indicator. The SSE stream wiring lives in Task 26
// (where we hook `/api/health/stream`); for the skeleton we expose a
// `status` prop so the Header can render the dot + label deterministically.

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

export type HealthStatus = 'online' | 'offline' | 'unknown'

interface Props {
  status?: HealthStatus
}
const props = withDefaults(defineProps<Props>(), { status: 'unknown' })

const { t } = useI18n()

const dotClass = computed(() => {
  switch (props.status) {
    case 'online':
      return 'bg-emerald-500'
    case 'offline':
      return 'bg-destructive'
    default:
      return 'bg-muted-foreground/50'
  }
})

const label = computed(() => {
  switch (props.status) {
    case 'online':
      return t('health.online')
    case 'offline':
      return t('health.offline')
    default:
      return t('health.unknown')
  }
})
</script>

<template>
  <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
    <span :class="['inline-block h-2 w-2 rounded-full', dotClass]" aria-hidden="true"></span>
    <span>{{ label }}</span>
  </span>
</template>
