<script setup lang="ts">
// TUN page — structured editor for the top-level `tun:` section of a mihomo
// config. Mirrors Dns.vue: every known mihomo TUN knob is editable here;
// unknown keys are preserved verbatim on `extras` (the view projection
// copies them through on round-trip).
//
// Data flow identical to Dns.vue:
//   1. configStore.loadAll() pulls the draft + live config on mount.
//   2. `configStore.tunConfig` is a computed view derived from the draft
//      doc (see apps/web/src/lib/tun-view.ts — mirror of the server
//      projection).
//   3. Sub-forms emit their slice back up here; we merge and call
//      `configStore.setTunConfigDraft`.
//   4. That mutator rewrites the `tun:` key in the YAML Document and PUTs
//      the draft. Dirty-count + lint pipeline do the rest.
//
// The `route-exclude-address` list gets a dedicated subcomponent
// (RouteExcludeList) that cross-references every entry against the current
// draft's proxy-server IPs — a missing exclusion is a self-intercept loop
// waiting to happen (server CLAUDE.md invariant #14).

import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TunConfig } from 'miharbor-shared'
import { useConfigStore } from '@/stores/config'
import NameserverList from '@/components/dns/NameserverList.vue'
import TunConfigForm from '@/components/tun/TunConfigForm.vue'
import RouteExcludeList from '@/components/tun/RouteExcludeList.vue'

const { t } = useI18n()
const config = useConfigStore()

onMounted(() => {
  void config.loadAll()
})

const tun = computed<TunConfig>(() => config.tunConfig)

/** Bare IPs of every proxy-server in the current draft. `draftProxies`
 *  already runs on every draftText change so this stays reactive. */
const proxyServerIps = computed<string[]>(() => {
  const out: string[] = []
  for (const p of config.proxies) {
    const server = typeof p.server === 'string' ? p.server.trim() : ''
    if (server.length > 0) out.push(server)
  }
  return out
})

function emitPatch(patch: Partial<TunConfig>): void {
  const merged: TunConfig = { ...tun.value, ...patch }
  for (const k of Object.keys(patch) as (keyof TunConfig)[]) {
    if (patch[k] === undefined) {
      delete (merged as Record<string, unknown>)[k]
    }
  }
  void config.setTunConfigDraft(merged).catch((e) => {
    console.error('setTunConfigDraft failed', e)
  })
}

function onListField(key: keyof TunConfig, values: string[]): void {
  // Empty list → undefined (removes the key entirely). Exception:
  // `dns-hijack: []` is a load-bearing "explicitly empty" per the server
  // runbook (invariant #12). We preserve the empty array only when the key
  // was already present; otherwise omit.
  if (values.length > 0) {
    emitPatch({ [key]: values } as Partial<TunConfig>)
    return
  }
  // For dns-hijack specifically: keep the empty array if the user already
  // had one (the `tun:` section is emitted with `dns-hijack: []`). The view
  // projection preserves empty arrays, so a delete only happens when the
  // user clicks remove on the last entry AND they want it gone — we
  // interpret that as "unset", which matches the Dns page's semantics.
  emitPatch({ [key]: undefined } as Partial<TunConfig>)
}

const extras = computed<Record<string, unknown> | null>(() => {
  const e = tun.value.extras
  if (!e || Object.keys(e).length === 0) return null
  return e
})
</script>

<template>
  <section class="space-y-6" data-testid="tun-page">
    <header class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight">{{ t('pages.tun.title') }}</h1>
      <p class="text-sm text-muted-foreground">{{ t('pages.tun.subtitle') }}</p>
    </header>

    <!-- General / scalar fields -->
    <section class="space-y-4 rounded-md border border-border bg-card/30 p-4">
      <h2 class="text-lg font-semibold">{{ t('pages.tun.sections.general') }}</h2>
      <TunConfigForm :model-value="tun" @update:model-value="emitPatch" />
    </section>

    <!-- DNS hijack -->
    <section class="space-y-2 rounded-md border border-border bg-card/30 p-4">
      <h2 class="text-lg font-semibold">{{ t('pages.tun.sections.dns_hijack') }}</h2>
      <p class="text-xs text-muted-foreground">{{ t('pages.tun.dns_hijack.hint') }}</p>
      <NameserverList
        :model-value="tun['dns-hijack'] ?? []"
        :placeholder="t('pages.tun.dns_hijack.placeholder')"
        :aria-label="t('pages.tun.dns_hijack.aria_label')"
        @update:model-value="(v: string[]) => onListField('dns-hijack', v)"
      />
    </section>

    <!-- Route exclude -->
    <section class="space-y-3 rounded-md border border-border bg-card/30 p-4">
      <h2 class="text-lg font-semibold">{{ t('pages.tun.sections.route_exclude') }}</h2>
      <p class="text-xs text-muted-foreground">{{ t('pages.tun.route_exclude.description') }}</p>
      <RouteExcludeList
        :model-value="tun['route-exclude-address'] ?? []"
        :proxy-server-ips="proxyServerIps"
        :placeholder="t('pages.tun.route_exclude.placeholder')"
        :aria-label="t('pages.tun.route_exclude.aria_label')"
        @update:model-value="(v: string[]) => onListField('route-exclude-address', v)"
      />
    </section>

    <!-- Additional route-address -->
    <section class="space-y-2 rounded-md border border-border bg-card/30 p-4">
      <h2 class="text-lg font-semibold">{{ t('pages.tun.sections.route_address') }}</h2>
      <p class="text-xs text-muted-foreground">{{ t('pages.tun.route_address.hint') }}</p>
      <NameserverList
        :model-value="tun['route-address'] ?? []"
        :placeholder="t('pages.tun.route_address.placeholder')"
        :aria-label="t('pages.tun.route_address.aria_label')"
        @update:model-value="(v: string[]) => onListField('route-address', v)"
      />
    </section>

    <!-- Addresses + exclude interfaces -->
    <section class="space-y-4 rounded-md border border-border bg-card/30 p-4">
      <h2 class="text-lg font-semibold">{{ t('pages.tun.sections.addresses') }}</h2>

      <div class="space-y-2">
        <label class="block text-xs font-medium uppercase text-muted-foreground">
          {{ t('pages.tun.fields.inet4_address') }}
        </label>
        <NameserverList
          :model-value="tun['inet4-address'] ?? []"
          :placeholder="t('pages.tun.fields.inet4_placeholder')"
          :aria-label="t('pages.tun.fields.inet4_address')"
          @update:model-value="(v: string[]) => onListField('inet4-address', v)"
        />
      </div>

      <div class="space-y-2">
        <label class="block text-xs font-medium uppercase text-muted-foreground">
          {{ t('pages.tun.fields.inet6_address') }}
        </label>
        <NameserverList
          :model-value="tun['inet6-address'] ?? []"
          :placeholder="t('pages.tun.fields.inet6_placeholder')"
          :aria-label="t('pages.tun.fields.inet6_address')"
          @update:model-value="(v: string[]) => onListField('inet6-address', v)"
        />
      </div>

      <div class="space-y-2">
        <label class="block text-xs font-medium uppercase text-muted-foreground">
          {{ t('pages.tun.fields.exclude_interface') }}
        </label>
        <NameserverList
          :model-value="tun['exclude-interface'] ?? []"
          :placeholder="t('pages.tun.fields.exclude_interface_placeholder')"
          :aria-label="t('pages.tun.fields.exclude_interface')"
          @update:model-value="(v: string[]) => onListField('exclude-interface', v)"
        />
      </div>
    </section>

    <!-- Preserved unknown keys -->
    <section
      v-if="extras"
      class="space-y-2 rounded-md border border-dashed border-border bg-card/20 p-4"
      data-testid="tun-extras"
    >
      <h2 class="text-sm font-medium uppercase text-muted-foreground">
        {{ t('pages.tun.sections.extras') }}
      </h2>
      <p class="text-xs text-muted-foreground">{{ t('pages.tun.extras.note') }}</p>
      <ul class="text-xs font-mono">
        <li v-for="k in Object.keys(extras)" :key="k">{{ k }}</li>
      </ul>
    </section>
  </section>
</template>
