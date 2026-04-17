<script setup lang="ts">
// Sniffer page — structured editor for the top-level `sniffer:` section.
// Same pattern as Dns.vue / Tun.vue: every known mihomo knob is editable
// here; unknown keys round-trip via `extras` (see sniffer view + mutator).
//
// Data flow:
//   1. configStore.loadAll() pulls the draft on mount.
//   2. `configStore.snifferConfig` derives the typed view from the draft
//      doc (see apps/web/src/lib/sniffer-view.ts — mirror of the server
//      projection).
//   3. Scalar toggles, per-protocol SniffRulesList, and the simple list
//      editors all emit partial patches up here; we merge and call
//      `configStore.setSnifferConfigDraft`.
//   4. That mutator rewrites the `sniffer:` key in the YAML Document and
//      PUTs the draft. Dirty-count + lint pipeline do the rest.
//
// Empty-list semantics match DNS/TUN (see Task 34/35 commit eeba4b6):
// removing the last entry from a list → the YAML key is deleted (not
// emitted as `[]`). If the user needs explicit `[]`, Raw YAML is the
// escape hatch.

import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SnifferConfig, SnifferProtocol, SnifferProtocolConfig } from 'miharbor-shared'
import { useConfigStore } from '@/stores/config'
import NameserverList from '@/components/dns/NameserverList.vue'
import SniffRulesList from '@/components/sniffer/SniffRulesList.vue'
import GuardrailPlate from '@/components/ui/GuardrailPlate.vue'
import { validatePortRange } from 'miharbor-shared'

const { t } = useI18n()
const config = useConfigStore()

onMounted(() => {
  void config.loadAll()
})

const sniffer = computed<SnifferConfig>(() => config.snifferConfig)

function emitPatch(patch: Partial<SnifferConfig>): void {
  const merged: SnifferConfig = { ...sniffer.value, ...patch }
  for (const k of Object.keys(patch) as (keyof SnifferConfig)[]) {
    if (patch[k] === undefined) {
      delete (merged as Record<string, unknown>)[k]
    }
  }
  void config.setSnifferConfigDraft(merged).catch((e) => {
    console.error('setSnifferConfigDraft failed', e)
  })
}

function onToggle(key: keyof SnifferConfig, checked: boolean): void {
  emitPatch({ [key]: checked } as Partial<SnifferConfig>)
}

/** Empty list → delete the YAML key. Mirrors the DNS/TUN pattern. */
function onListField(key: 'force-domain' | 'skip-domain' | 'port-whitelist', values: string[]) {
  if (values.length > 0) {
    emitPatch({ [key]: values } as Partial<SnifferConfig>)
  } else {
    emitPatch({ [key]: undefined } as Partial<SnifferConfig>)
  }
}

/** Update a single protocol's ports list. Empty ports list (and no
 *  per-protocol override-destination) → the protocol is removed from the
 *  `sniff:` map; when the map goes empty, it's removed too. */
function onProtocolPorts(protocol: SnifferProtocol, ports: string[]): void {
  const currentSniff = sniffer.value.sniff ?? {}
  const currentProto = currentSniff[protocol] ?? {}
  const nextProto: SnifferProtocolConfig = { ...currentProto }
  if (ports.length > 0) {
    nextProto.ports = ports
  } else {
    delete nextProto.ports
  }
  applyProtocolPatch(protocol, nextProto)
}

function onProtocolOverride(protocol: SnifferProtocol, checked: boolean): void {
  const currentSniff = sniffer.value.sniff ?? {}
  const currentProto = currentSniff[protocol] ?? {}
  const nextProto: SnifferProtocolConfig = { ...currentProto, 'override-destination': checked }
  applyProtocolPatch(protocol, nextProto)
}

function applyProtocolPatch(protocol: SnifferProtocol, nextProto: SnifferProtocolConfig): void {
  const currentSniff = sniffer.value.sniff ?? {}
  const nextSniff = { ...currentSniff }
  const isEmpty =
    (nextProto.ports === undefined || nextProto.ports.length === 0) &&
    nextProto['override-destination'] === undefined &&
    (nextProto.extras === undefined || Object.keys(nextProto.extras).length === 0)
  if (isEmpty) {
    delete nextSniff[protocol]
  } else {
    nextSniff[protocol] = nextProto
  }
  // If every protocol went away and no extras remain → remove sniff.
  const sniffHasAnything =
    nextSniff.HTTP ||
    nextSniff.TLS ||
    nextSniff.QUIC ||
    (nextSniff.extras && Object.keys(nextSniff.extras).length > 0)
  if (!sniffHasAnything) {
    emitPatch({ sniff: undefined })
  } else {
    emitPatch({ sniff: nextSniff })
  }
}

const httpPorts = computed<string[]>(() => sniffer.value.sniff?.HTTP?.ports ?? [])
const tlsPorts = computed<string[]>(() => sniffer.value.sniff?.TLS?.ports ?? [])
const quicPorts = computed<string[]>(() => sniffer.value.sniff?.QUIC?.ports ?? [])
const httpOverride = computed<boolean>(
  () => sniffer.value.sniff?.HTTP?.['override-destination'] ?? false,
)

const extras = computed<Record<string, unknown> | null>(() => {
  const e = sniffer.value.extras
  if (!e || Object.keys(e).length === 0) return null
  return e
})

const sniffExtras = computed<Record<string, unknown> | null>(() => {
  const e = sniffer.value.sniff?.extras
  if (!e || Object.keys(e).length === 0) return null
  return e
})

/** Validate each port-whitelist entry the same way SniffRulesList does;
 *  the NameserverList component accepts a per-entry validator that renders
 *  an amber chevron on failure. */
function portWhitelistValidator(value: string): string | null {
  return validatePortRange(value)
}
</script>

<template>
  <section class="space-y-6" data-testid="sniffer-page">
    <header class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight">{{ t('pages.sniffer.title') }}</h1>
      <p class="text-sm text-muted-foreground">{{ t('pages.sniffer.subtitle') }}</p>
    </header>

    <!-- General / scalar fields -->
    <section class="space-y-4 rounded-md border border-border bg-card/30 p-4">
      <h2 class="text-lg font-semibold">{{ t('pages.sniffer.sections.general') }}</h2>

      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="h-4 w-4"
          :checked="sniffer.enable ?? false"
          :aria-label="t('pages.sniffer.fields.enable')"
          data-testid="sniffer-enable"
          @change="(e) => onToggle('enable', (e.target as HTMLInputElement).checked)"
        />
        {{ t('pages.sniffer.fields.enable') }}
      </label>

      <div class="space-y-2">
        <label class="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            class="h-4 w-4"
            :checked="sniffer['override-destination'] ?? false"
            :aria-label="t('pages.sniffer.fields.override_destination')"
            data-testid="sniffer-override-destination"
            @change="
              (e) => onToggle('override-destination', (e.target as HTMLInputElement).checked)
            "
          />
          {{ t('pages.sniffer.fields.override_destination') }}
        </label>
        <GuardrailPlate
          :message="t('pages.sniffer.guardrails.override_destination')"
          data-testid="sniffer-override-guardrail"
        />
      </div>

      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="h-4 w-4"
          :checked="sniffer['parse-pure-ip'] ?? false"
          :aria-label="t('pages.sniffer.fields.parse_pure_ip')"
          data-testid="sniffer-parse-pure-ip"
          @change="(e) => onToggle('parse-pure-ip', (e.target as HTMLInputElement).checked)"
        />
        {{ t('pages.sniffer.fields.parse_pure_ip') }}
      </label>

      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="h-4 w-4"
          :checked="sniffer['force-dns-mapping'] ?? false"
          :aria-label="t('pages.sniffer.fields.force_dns_mapping')"
          data-testid="sniffer-force-dns-mapping"
          @change="(e) => onToggle('force-dns-mapping', (e.target as HTMLInputElement).checked)"
        />
        {{ t('pages.sniffer.fields.force_dns_mapping') }}
      </label>
    </section>

    <!-- Per-protocol port config -->
    <section class="space-y-4 rounded-md border border-border bg-card/30 p-4">
      <h2 class="text-lg font-semibold">{{ t('pages.sniffer.sections.protocols') }}</h2>
      <p class="text-xs text-muted-foreground">{{ t('pages.sniffer.protocols.description') }}</p>

      <div class="space-y-2">
        <h3 class="text-sm font-medium">{{ t('pages.sniffer.protocols.http') }}</h3>
        <SniffRulesList
          protocol="HTTP"
          :model-value="httpPorts"
          :allow-override="true"
          :override-destination="httpOverride"
          @update:model-value="(v: string[]) => onProtocolPorts('HTTP', v)"
          @update:override-destination="(v: boolean) => onProtocolOverride('HTTP', v)"
        />
      </div>

      <div class="space-y-2">
        <h3 class="text-sm font-medium">{{ t('pages.sniffer.protocols.tls') }}</h3>
        <SniffRulesList
          protocol="TLS"
          :model-value="tlsPorts"
          @update:model-value="(v: string[]) => onProtocolPorts('TLS', v)"
        />
      </div>

      <div class="space-y-2">
        <h3 class="text-sm font-medium">{{ t('pages.sniffer.protocols.quic') }}</h3>
        <SniffRulesList
          protocol="QUIC"
          :model-value="quicPorts"
          @update:model-value="(v: string[]) => onProtocolPorts('QUIC', v)"
        />
      </div>

      <section
        v-if="sniffExtras"
        class="space-y-2 rounded-md border border-dashed border-border bg-card/20 p-3"
        data-testid="sniff-extras"
      >
        <h3 class="text-xs font-medium uppercase text-muted-foreground">
          {{ t('pages.sniffer.protocols.extras_title') }}
        </h3>
        <p class="text-xs text-muted-foreground">{{ t('pages.sniffer.protocols.extras_note') }}</p>
        <ul class="text-xs font-mono">
          <li v-for="k in Object.keys(sniffExtras)" :key="k">{{ k }}</li>
        </ul>
      </section>
    </section>

    <!-- Force / skip domain + port whitelist -->
    <section class="space-y-4 rounded-md border border-border bg-card/30 p-4">
      <h2 class="text-lg font-semibold">{{ t('pages.sniffer.sections.domains') }}</h2>

      <div class="space-y-2">
        <label class="block text-xs font-medium uppercase text-muted-foreground">
          {{ t('pages.sniffer.fields.force_domain') }}
        </label>
        <p class="text-xs text-muted-foreground">
          {{ t('pages.sniffer.fields.force_domain_hint') }}
        </p>
        <NameserverList
          :model-value="sniffer['force-domain'] ?? []"
          :placeholder="t('pages.sniffer.fields.force_domain_placeholder')"
          :aria-label="t('pages.sniffer.fields.force_domain')"
          @update:model-value="(v: string[]) => onListField('force-domain', v)"
        />
      </div>

      <div class="space-y-2">
        <label class="block text-xs font-medium uppercase text-muted-foreground">
          {{ t('pages.sniffer.fields.skip_domain') }}
        </label>
        <p class="text-xs text-muted-foreground">
          {{ t('pages.sniffer.fields.skip_domain_hint') }}
        </p>
        <NameserverList
          :model-value="sniffer['skip-domain'] ?? []"
          :placeholder="t('pages.sniffer.fields.skip_domain_placeholder')"
          :aria-label="t('pages.sniffer.fields.skip_domain')"
          @update:model-value="(v: string[]) => onListField('skip-domain', v)"
        />
      </div>
    </section>

    <!-- Port whitelist -->
    <section class="space-y-2 rounded-md border border-border bg-card/30 p-4">
      <h2 class="text-lg font-semibold">{{ t('pages.sniffer.sections.port_whitelist') }}</h2>
      <p class="text-xs text-muted-foreground">
        {{ t('pages.sniffer.fields.port_whitelist_hint') }}
      </p>
      <NameserverList
        :model-value="sniffer['port-whitelist'] ?? []"
        :placeholder="t('pages.sniffer.fields.port_whitelist_placeholder')"
        :aria-label="t('pages.sniffer.fields.port_whitelist')"
        :validator="portWhitelistValidator"
        @update:model-value="(v: string[]) => onListField('port-whitelist', v)"
      />
    </section>

    <!-- Preserved unknown top-level keys -->
    <section
      v-if="extras"
      class="space-y-2 rounded-md border border-dashed border-border bg-card/20 p-4"
      data-testid="sniffer-extras"
    >
      <h2 class="text-sm font-medium uppercase text-muted-foreground">
        {{ t('pages.sniffer.sections.extras') }}
      </h2>
      <p class="text-xs text-muted-foreground">{{ t('pages.sniffer.extras.note') }}</p>
      <ul class="text-xs font-mono">
        <li v-for="k in Object.keys(extras)" :key="k">{{ k }}</li>
      </ul>
    </section>
  </section>
</template>
