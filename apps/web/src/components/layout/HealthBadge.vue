<script setup lang="ts">
// Compact mihomo-up/down indicator driven by the /api/health/stream SSE.
//
// On mount, opens a native EventSource to `/api/health/stream` (GET — no
// body, credentials included). The server's HealthMonitor re-broadcasts
// `mihomo-up` / `mihomo-down` / `canonicalized` events; we map the first
// two to the badge colour and emit `canonicalized` upward so the parent
// (Header) can show a one-shot banner.
//
// Graceful degradation:
//  * If EventSource is unavailable (e.g. static snapshot preview) we fall
//    back to an initial `GET /api/health` poll and show that as a static
//    badge.
//  * On stream error we reset to 'unknown' and retry with exponential
//    backoff (max 30s).

import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'

export type HealthStatus = 'online' | 'offline' | 'unknown'

interface Props {
  status?: HealthStatus
}
const props = withDefaults(defineProps<Props>(), { status: 'unknown' })

const emit = defineEmits<{ canonicalized: [payload: CanonicalizedEvent] }>()

export interface CanonicalizedEvent {
  old_hash: string
  new_hash: string
  snapshot_id: string
  ts: string
}

const liveStatus = ref<HealthStatus>('unknown')
const effectiveStatus = computed<HealthStatus>(() =>
  liveStatus.value !== 'unknown' ? liveStatus.value : props.status,
)

const { t } = useI18n()

let es: EventSource | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let backoffMs = 1000

function scheduleReconnect(): void {
  if (retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    connect()
  }, backoffMs)
  backoffMs = Math.min(backoffMs * 2, 30_000)
}

function connect(): void {
  if (typeof EventSource === 'undefined') return
  try {
    es = new EventSource('/api/health/stream', { withCredentials: true })
  } catch {
    scheduleReconnect()
    return
  }
  es.addEventListener('mihomo-up', () => {
    liveStatus.value = 'online'
    backoffMs = 1000
  })
  es.addEventListener('mihomo-down', () => {
    liveStatus.value = 'offline'
    backoffMs = 1000
  })
  es.addEventListener('canonicalized', (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data) as CanonicalizedEvent
      emit('canonicalized', data)
    } catch {
      /* ignore malformed payload */
    }
  })
  es.onerror = () => {
    // Browser auto-reconnects on transient errors; if readyState stays
    // CLOSED we kick a manual retry.
    if (es && es.readyState === EventSource.CLOSED) {
      es = null
      scheduleReconnect()
    }
  }
}

onMounted(() => {
  connect()
})

onBeforeUnmount(() => {
  if (es) {
    es.close()
    es = null
  }
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
})

const dotClass = computed(() => {
  switch (effectiveStatus.value) {
    case 'online':
      return 'bg-emerald-500'
    case 'offline':
      return 'bg-destructive'
    default:
      return 'bg-muted-foreground/50'
  }
})

const label = computed(() => {
  switch (effectiveStatus.value) {
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
