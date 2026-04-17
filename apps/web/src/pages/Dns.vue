<script setup lang="ts">
// DNS page — structured editor for the top-level `dns:` section of a mihomo
// config. Every known mihomo DNS knob is editable here; unknown keys are
// preserved verbatim on `extras` (the view projection copies them through on
// round-trip).
//
// Data flow:
//   1. configStore.loadAll() pulls the draft + live config on mount.
//   2. `configStore.dnsConfig` is a computed view derived from the draft doc
//      (see apps/web/src/lib/dns-view.ts — mirror of the server projection).
//   3. Every subcomponent emits its slice back up here; we merge the slice
//      into a fresh DnsConfig object and call `configStore.setDnsConfigDraft`.
//   4. That mutator rewrites the `dns:` key in the YAML Document and PUTs the
//      draft. The store's dirty-count + lint pipeline do the rest.
//
// Guardrail plates surface on `listen`, `default-nameserver`, and
// `proxy-server-nameserver` (see invariants in CLAUDE.md).

import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle } from 'lucide-vue-next'
import type {
  DnsCacheAlgorithm,
  DnsConfig,
  DnsEnhancedMode,
  DnsFakeIpFilterMode,
} from 'miharbor-shared'
import { validateDnsListen, validateLiteralIp } from 'miharbor-shared'
import { useConfigStore } from '@/stores/config'
import { Input } from '@/components/ui/input'
import NameserverList from '@/components/dns/NameserverList.vue'
import FakeIpFilterList from '@/components/dns/FakeIpFilterList.vue'
import NameserverPolicy from '@/components/dns/NameserverPolicy.vue'

const { t } = useI18n()
const config = useConfigStore()

onMounted(() => {
  void config.loadAll()
})

const dns = computed<DnsConfig>(() => config.dnsConfig)

// Guardrail reasons — localized strings when the current value violates an
// invariant, `null` otherwise.
const listenWarning = computed<string | null>(() => {
  const reason = validateDnsListen(dns.value.listen)
  if (!reason) return null
  if (reason.includes('0.0.0.0')) return t('pages.dns.guardrails.listen_lan')
  if (reason.includes(':53')) return t('pages.dns.guardrails.listen_port_53')
  return reason
})

function literalIpValidator(v: string): string | null {
  const reason = validateLiteralIp(v)
  return reason ? t('pages.dns.guardrails.literal_ip_required') : null
}

// ----- commit helpers: merge a slice, send the whole DnsConfig -----------
//
// We always emit a fresh DnsConfig object built from the current view plus
// the changed slice — this keeps setDnsConfigDraft's contract simple (full
// rewrite, not diff-apply).

function emitPatch(patch: Partial<DnsConfig>): void {
  const merged: DnsConfig = { ...dns.value, ...patch }
  // `undefined` in a patch means "unset" — strip it so the mutator doesn't
  // persist literal undefined values back to YAML.
  for (const k of Object.keys(patch) as (keyof DnsConfig)[]) {
    if (patch[k] === undefined) {
      delete (merged as Record<string, unknown>)[k]
    }
  }
  void config.setDnsConfigDraft(merged).catch((e) => {
    // The store surfaces errors via `draftError`; here we just log the trace.
    console.error('setDnsConfigDraft failed', e)
  })
}

// Scalar field setters — each accepts the new value (or the empty sentinel to
// unset the key). All of them funnel through `emitPatch` above.
function onToggle(key: keyof DnsConfig, value: boolean): void {
  emitPatch({ [key]: value } as Partial<DnsConfig>)
}

function onStringField(key: keyof DnsConfig, value: string): void {
  const next = value.trim().length > 0 ? value : undefined
  emitPatch({ [key]: next } as Partial<DnsConfig>)
}

function onEnhancedMode(event: Event): void {
  const v = (event.target as HTMLSelectElement).value as DnsEnhancedMode | ''
  emitPatch({ 'enhanced-mode': v === '' ? undefined : v })
}

function onCacheAlgorithm(event: Event): void {
  const v = (event.target as HTMLSelectElement).value as DnsCacheAlgorithm | ''
  emitPatch({ 'cache-algorithm': v === '' ? undefined : v })
}

function onFakeIpFilterMode(mode: DnsFakeIpFilterMode): void {
  emitPatch({ 'fake-ip-filter-mode': mode })
}

function onFakeIpFilter(values: string[]): void {
  emitPatch({ 'fake-ip-filter': values.length > 0 ? values : undefined })
}

function onListField(key: keyof DnsConfig, values: string[]): void {
  emitPatch({ [key]: values.length > 0 ? values : undefined } as Partial<DnsConfig>)
}

function onPolicyChange(next: Record<string, string | string[]>): void {
  const hasEntries = Object.keys(next).length > 0
  emitPatch({ 'nameserver-policy': hasEntries ? next : undefined })
}

// Small helper to render the current enum value when computing selector state.
const enhancedMode = computed<DnsEnhancedMode | ''>(() => dns.value['enhanced-mode'] ?? '')
const cacheAlgorithm = computed<DnsCacheAlgorithm | ''>(() => dns.value['cache-algorithm'] ?? '')
const fakeIpFilterMode = computed<DnsFakeIpFilterMode>(
  () => dns.value['fake-ip-filter-mode'] ?? 'blacklist',
)

const extras = computed<Record<string, unknown> | null>(() => {
  const e = dns.value.extras
  if (!e || Object.keys(e).length === 0) return null
  return e
})
</script>

<template>
  <section class="space-y-6" data-testid="dns-page">
    <header class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight">{{ t('pages.dns.title') }}</h1>
      <p class="text-sm text-muted-foreground">{{ t('pages.dns.subtitle') }}</p>
    </header>

    <!-- General -->
    <section class="space-y-4 rounded-md border border-border bg-card/30 p-4">
      <h2 class="text-lg font-semibold">{{ t('pages.dns.sections.general') }}</h2>

      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="h-4 w-4"
          :checked="dns.enable ?? false"
          data-testid="dns-enable"
          @change="(e) => onToggle('enable', (e.target as HTMLInputElement).checked)"
        />
        {{ t('pages.dns.fields.enable') }}
      </label>

      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="h-4 w-4"
          :checked="dns.ipv6 ?? false"
          data-testid="dns-ipv6"
          @change="(e) => onToggle('ipv6', (e.target as HTMLInputElement).checked)"
        />
        {{ t('pages.dns.fields.ipv6') }}
      </label>

      <!-- Listen — guardrail plate -->
      <div class="space-y-1">
        <label class="block text-xs font-medium uppercase text-muted-foreground" for="dns-listen">
          {{ t('pages.dns.fields.listen') }}
        </label>
        <Input
          id="dns-listen"
          :model-value="dns.listen ?? ''"
          :placeholder="t('pages.dns.fields.listen_placeholder')"
          class="h-9"
          data-testid="dns-listen"
          @update:model-value="(v: string | number) => onStringField('listen', String(v))"
        />
        <p class="text-xs text-muted-foreground">
          {{ t('pages.dns.fields.listen_hint') }}
        </p>
        <p
          class="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400"
          data-testid="listen-guardrail"
        >
          <AlertTriangle class="h-4 w-4 shrink-0" />
          <span>
            {{ t('pages.dns.guardrails.listen_header') }}
            <template v-if="listenWarning">
              <span class="block font-medium">{{ listenWarning }}</span>
            </template>
          </span>
        </p>
      </div>

      <div class="space-y-1">
        <label
          class="block text-xs font-medium uppercase text-muted-foreground"
          for="dns-enhanced-mode"
        >
          {{ t('pages.dns.fields.enhanced_mode') }}
        </label>
        <select
          id="dns-enhanced-mode"
          :value="enhancedMode"
          class="h-9 rounded-md border border-input bg-background px-2 text-sm"
          data-testid="dns-enhanced-mode"
          @change="onEnhancedMode"
        >
          <option value="">—</option>
          <option value="fake-ip">{{ t('pages.dns.enhanced_mode.fake-ip') }}</option>
          <option value="redir-host">{{ t('pages.dns.enhanced_mode.redir-host') }}</option>
          <option value="normal">{{ t('pages.dns.enhanced_mode.normal') }}</option>
        </select>
      </div>

      <div class="space-y-1">
        <label
          class="block text-xs font-medium uppercase text-muted-foreground"
          for="dns-cache-algorithm"
        >
          {{ t('pages.dns.fields.cache_algorithm') }}
        </label>
        <select
          id="dns-cache-algorithm"
          :value="cacheAlgorithm"
          class="h-9 rounded-md border border-input bg-background px-2 text-sm"
          data-testid="dns-cache-algorithm"
          @change="onCacheAlgorithm"
        >
          <option value="">—</option>
          <option value="arc">{{ t('pages.dns.cache_algorithm.arc') }}</option>
          <option value="lru">{{ t('pages.dns.cache_algorithm.lru') }}</option>
        </select>
      </div>

      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="h-4 w-4"
          :checked="dns['use-hosts'] ?? false"
          @change="(e) => onToggle('use-hosts', (e.target as HTMLInputElement).checked)"
        />
        {{ t('pages.dns.fields.use_hosts') }}
      </label>

      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="h-4 w-4"
          :checked="dns['use-system-hosts'] ?? false"
          @change="(e) => onToggle('use-system-hosts', (e.target as HTMLInputElement).checked)"
        />
        {{ t('pages.dns.fields.use_system_hosts') }}
      </label>

      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="h-4 w-4"
          :checked="dns['respect-rules'] ?? false"
          @change="(e) => onToggle('respect-rules', (e.target as HTMLInputElement).checked)"
        />
        {{ t('pages.dns.fields.respect_rules') }}
      </label>

      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="h-4 w-4"
          :checked="dns['direct-nameserver-follow-policy'] ?? false"
          @change="
            (e) =>
              onToggle('direct-nameserver-follow-policy', (e.target as HTMLInputElement).checked)
          "
        />
        {{ t('pages.dns.fields.direct_nameserver_follow_policy') }}
      </label>
    </section>

    <!-- Fake-IP -->
    <section class="space-y-4 rounded-md border border-border bg-card/30 p-4">
      <h2 class="text-lg font-semibold">{{ t('pages.dns.sections.fake_ip') }}</h2>

      <div class="space-y-1">
        <label
          class="block text-xs font-medium uppercase text-muted-foreground"
          for="dns-fake-ip-range"
        >
          {{ t('pages.dns.fields.fake_ip_range') }}
        </label>
        <Input
          id="dns-fake-ip-range"
          :model-value="dns['fake-ip-range'] ?? ''"
          :placeholder="t('pages.dns.fields.fake_ip_range_placeholder')"
          class="h-9"
          data-testid="dns-fake-ip-range"
          @update:model-value="(v: string | number) => onStringField('fake-ip-range', String(v))"
        />
      </div>

      <div class="space-y-2">
        <label class="block text-xs font-medium uppercase text-muted-foreground">
          {{ t('pages.dns.fields.fake_ip_filter') }}
        </label>
        <FakeIpFilterList
          :model-value="dns['fake-ip-filter'] ?? []"
          :mode="fakeIpFilterMode"
          @update:model-value="onFakeIpFilter"
          @update:mode="onFakeIpFilterMode"
        />
      </div>
    </section>

    <!-- Resolvers -->
    <section class="space-y-6 rounded-md border border-border bg-card/30 p-4">
      <h2 class="text-lg font-semibold">{{ t('pages.dns.sections.resolvers') }}</h2>

      <!-- default-nameserver — literal IPs required -->
      <div class="space-y-2">
        <label class="block text-xs font-medium uppercase text-muted-foreground">
          {{ t('pages.dns.fields.default_nameserver') }}
        </label>
        <p
          class="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400"
          data-testid="default-ns-guardrail"
        >
          <AlertTriangle class="h-4 w-4 shrink-0" />
          {{ t('pages.dns.guardrails.default_ns_header') }}
        </p>
        <NameserverList
          :model-value="dns['default-nameserver'] ?? []"
          :placeholder="t('pages.dns.placeholders.ip_nameserver')"
          :validator="literalIpValidator"
          @update:model-value="(v: string[]) => onListField('default-nameserver', v)"
        />
      </div>

      <!-- main nameserver -->
      <div class="space-y-2">
        <label class="block text-xs font-medium uppercase text-muted-foreground">
          {{ t('pages.dns.fields.nameserver') }}
        </label>
        <NameserverList
          :model-value="dns.nameserver ?? []"
          :placeholder="t('pages.dns.placeholders.nameserver')"
          @update:model-value="(v: string[]) => onListField('nameserver', v)"
        />
      </div>

      <!-- fallback -->
      <div class="space-y-2">
        <label class="block text-xs font-medium uppercase text-muted-foreground">
          {{ t('pages.dns.fields.fallback') }}
        </label>
        <NameserverList
          :model-value="dns.fallback ?? []"
          :placeholder="t('pages.dns.placeholders.nameserver')"
          @update:model-value="(v: string[]) => onListField('fallback', v)"
        />
      </div>

      <!-- proxy-server-nameserver — literal IPs required -->
      <div class="space-y-2">
        <label class="block text-xs font-medium uppercase text-muted-foreground">
          {{ t('pages.dns.fields.proxy_server_nameserver') }}
        </label>
        <p
          class="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400"
          data-testid="proxy-ns-guardrail"
        >
          <AlertTriangle class="h-4 w-4 shrink-0" />
          {{ t('pages.dns.guardrails.proxy_ns_header') }}
        </p>
        <NameserverList
          :model-value="dns['proxy-server-nameserver'] ?? []"
          :placeholder="t('pages.dns.placeholders.ip_nameserver')"
          :validator="literalIpValidator"
          @update:model-value="(v: string[]) => onListField('proxy-server-nameserver', v)"
        />
      </div>

      <!-- direct-nameserver -->
      <div class="space-y-2">
        <label class="block text-xs font-medium uppercase text-muted-foreground">
          {{ t('pages.dns.fields.direct_nameserver') }}
        </label>
        <NameserverList
          :model-value="dns['direct-nameserver'] ?? []"
          :placeholder="t('pages.dns.placeholders.nameserver')"
          @update:model-value="(v: string[]) => onListField('direct-nameserver', v)"
        />
      </div>
    </section>

    <!-- Nameserver policy -->
    <section class="space-y-4 rounded-md border border-border bg-card/30 p-4">
      <h2 class="text-lg font-semibold">{{ t('pages.dns.sections.policy') }}</h2>
      <NameserverPolicy
        :model-value="dns['nameserver-policy']"
        @update:model-value="onPolicyChange"
      />
    </section>

    <!-- Fallback filter -->
    <section class="space-y-4 rounded-md border border-border bg-card/30 p-4">
      <h2 class="text-lg font-semibold">{{ t('pages.dns.sections.fallback') }}</h2>

      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="h-4 w-4"
          :checked="dns['fallback-filter']?.geoip ?? false"
          data-testid="fallback-filter-geoip"
          @change="
            (e) =>
              emitPatch({
                'fallback-filter': {
                  ...(dns['fallback-filter'] ?? {}),
                  geoip: (e.target as HTMLInputElement).checked,
                },
              })
          "
        />
        fallback-filter.geoip
      </label>

      <div class="space-y-1">
        <label class="block text-xs font-medium uppercase text-muted-foreground">
          fallback-filter.geoip-code
        </label>
        <Input
          :model-value="dns['fallback-filter']?.['geoip-code'] ?? ''"
          placeholder="RU"
          class="h-9"
          data-testid="fallback-filter-geoip-code"
          @update:model-value="
            (v: string | number) =>
              emitPatch({
                'fallback-filter': {
                  ...(dns['fallback-filter'] ?? {}),
                  'geoip-code': String(v).trim() || undefined,
                },
              })
          "
        />
      </div>

      <div class="space-y-2">
        <label class="block text-xs font-medium uppercase text-muted-foreground">
          fallback-filter.ipcidr
        </label>
        <NameserverList
          :model-value="dns['fallback-filter']?.ipcidr ?? []"
          placeholder="240.0.0.0/4"
          @update:model-value="
            (v: string[]) =>
              emitPatch({
                'fallback-filter': {
                  ...(dns['fallback-filter'] ?? {}),
                  ipcidr: v.length > 0 ? v : undefined,
                },
              })
          "
        />
      </div>

      <div class="space-y-2">
        <label class="block text-xs font-medium uppercase text-muted-foreground">
          fallback-filter.geosite
        </label>
        <NameserverList
          :model-value="dns['fallback-filter']?.geosite ?? []"
          placeholder="cn"
          @update:model-value="
            (v: string[]) =>
              emitPatch({
                'fallback-filter': {
                  ...(dns['fallback-filter'] ?? {}),
                  geosite: v.length > 0 ? v : undefined,
                },
              })
          "
        />
      </div>

      <div class="space-y-2">
        <label class="block text-xs font-medium uppercase text-muted-foreground">
          fallback-filter.domain
        </label>
        <NameserverList
          :model-value="dns['fallback-filter']?.domain ?? []"
          :placeholder="t('pages.dns.placeholders.domain_pattern')"
          @update:model-value="
            (v: string[]) =>
              emitPatch({
                'fallback-filter': {
                  ...(dns['fallback-filter'] ?? {}),
                  domain: v.length > 0 ? v : undefined,
                },
              })
          "
        />
      </div>
    </section>

    <!-- Preserved unknown keys -->
    <section
      v-if="extras"
      class="space-y-2 rounded-md border border-dashed border-border bg-card/20 p-4"
      data-testid="dns-extras"
    >
      <h2 class="text-sm font-medium uppercase text-muted-foreground">
        {{ t('pages.dns.sections.extras') }}
      </h2>
      <p class="text-xs text-muted-foreground">{{ t('pages.dns.extras.note') }}</p>
      <ul class="text-xs font-mono">
        <li v-for="k in Object.keys(extras)" :key="k">{{ k }}</li>
      </ul>
    </section>
  </section>
</template>
