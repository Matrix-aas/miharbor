<script setup lang="ts">
// GuardrailPlate — shared amber advisory box used across structured editors
// (DNS, TUN, Sniffer, Profile, …). Renders the canonical "invariant says:"
// plate pattern that the Dns.vue page used to inline three times.
//
// Usage:
//   <GuardrailPlate :message="t('…header')" data-testid="listen-guardrail" />
//   <GuardrailPlate :message="t('…header')">
//     <template #default> extra block content </template>
//   </GuardrailPlate>
//
// The default slot appears inside the same <span> as `message`, appended after
// it, so callers can surface a dynamic sub-reason without losing the single
// aria-live region.

import { AlertTriangle } from 'lucide-vue-next'

interface Props {
  /** The localized guardrail message shown next to the icon. */
  message: string
}

defineProps<Props>()
</script>

<template>
  <p
    role="note"
    aria-live="polite"
    class="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400"
  >
    <AlertTriangle class="h-4 w-4 shrink-0 mt-px" aria-hidden="true" />
    <span>{{ message }}<slot /></span>
  </p>
</template>
