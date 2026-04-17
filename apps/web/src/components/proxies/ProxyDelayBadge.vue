<script setup lang="ts">
// ProxyDelayBadge — fetches mihomo's latency test for a single proxy node
// and colour-codes the result. Uses IntersectionObserver to lazy-load —
// we don't want a scroll-induced thundering herd against the mihomo API.
//
// Buckets:
//   <300ms  fast   (emerald)
//   <800ms  ok     (amber)
//   ≥800ms  slow   (orange)
//   error   timeout (red)

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Badge } from '@/components/ui/badge'
import { endpoints, ApiError } from '@/api/client'

interface Props {
  name: string
  /** Target URL for the delay test — mihomo default if omitted. */
  url?: string
}
const props = defineProps<Props>()

const { t } = useI18n()

const delay = ref<number | null>(null)
const failed = ref(false)
const loaded = ref(false)
const rootEl = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

async function runProbe(): Promise<void> {
  if (loaded.value) return
  loaded.value = true
  try {
    const opts: { url?: string; timeout?: number } = { timeout: 3000 }
    if (props.url) opts.url = props.url
    const res = await endpoints.mihomo.proxyDelay(props.name, opts)
    const ms = Number((res as { delay?: unknown }).delay ?? NaN)
    if (Number.isFinite(ms) && ms >= 0) {
      delay.value = ms
      failed.value = false
    } else {
      failed.value = true
    }
  } catch (e) {
    failed.value = true
    // Silent by design — mihomo can be down, the UI shouldn't yell.
    if (!(e instanceof ApiError)) return
  }
}

onMounted(() => {
  if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
    // jsdom / SSR fallback — trigger eagerly.
    void runProbe()
    return
  }
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          void runProbe()
          observer?.disconnect()
          observer = null
        }
      }
    },
    { rootMargin: '200px' },
  )
  if (rootEl.value) observer.observe(rootEl.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})

const tone = computed<'fast' | 'ok' | 'slow' | 'timeout' | 'unknown'>(() => {
  if (failed.value) return 'timeout'
  if (delay.value === null) return 'unknown'
  if (delay.value < 300) return 'fast'
  if (delay.value < 800) return 'ok'
  return 'slow'
})

const label = computed<string>(() => {
  if (tone.value === 'timeout') return t('proxies.delay.timeout')
  if (tone.value === 'unknown') return t('proxies.delay.unknown')
  const ms = delay.value ?? 0
  if (tone.value === 'fast') return t('proxies.delay.fast', { ms })
  if (tone.value === 'ok') return t('proxies.delay.ok', { ms })
  return t('proxies.delay.slow', { ms })
})

const badgeVariant = computed<'default' | 'secondary' | 'destructive' | 'muted' | 'outline'>(() => {
  if (tone.value === 'timeout') return 'destructive'
  if (tone.value === 'fast') return 'default'
  if (tone.value === 'ok') return 'secondary'
  if (tone.value === 'slow') return 'muted'
  return 'outline'
})
</script>

<template>
  <span ref="rootEl" class="inline-flex">
    <Badge :variant="badgeVariant" class="font-mono text-[11px]">
      {{ label }}
    </Badge>
  </span>
</template>
