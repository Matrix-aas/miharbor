<script setup lang="ts">
// ProfileForm — the big form for top-level mihomo scalars (mode, log-level,
// external-controller, secret, geo-* knobs, nested profile sub-section,
// authentication list). Emits a full Partial<ProfileConfig> patch per change
// so Profile.vue can merge+persist via setProfileConfigDraft.
//
// The `secret:` input is MASKED BY DEFAULT. An eye toggle reveals the text
// temporarily. The internal reveal state is local — leaving the page (or
// remounting the form) resets it to masked. The value itself lives in the
// store; we never keep a shadow copy here.
//
// Guardrails (see invariants in packages/shared/src/types/profile.ts):
//   * ipv6: true → first-rollout runbook forbids; plate below checkbox.
//   * external-controller bound non-loopback with empty secret → open
//     control plane; plate next to the secret row.
//   * authentication: section gets its own guardrail plate explaining that
//     passwords are not recoverable from the UI after write.

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Eye, EyeOff } from 'lucide-vue-next'
import type {
  GeoxUrlConfig,
  ProfileConfig,
  ProfileFindProcessMode,
  ProfileLogLevel,
  ProfileMode,
  ProfileNested,
} from 'miharbor-shared'
import {
  validateExternalController,
  validateGeoxUrlEntry,
  validateInterfaceNameVsAutoDetect,
  validateIpv6Enabled,
} from 'miharbor-shared'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import GuardrailPlate from '@/components/ui/GuardrailPlate.vue'
import AuthList from './AuthList.vue'

interface Props {
  modelValue: ProfileConfig
  /** TUN's `auto-detect-interface` flag — used to surface the guardrail when
   *  it's enabled while `interface-name` is also set. Lives on the TUN page,
   *  threaded through from the parent so we can render the cross-section
   *  warning inline with the interface-name input. */
  tunAutoDetectInterface?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{ 'update:modelValue': [patch: Partial<ProfileConfig>] }>()

const { t } = useI18n()

// ----- secret masking ----------------------------------------------------

const secretRevealed = ref(false)

const secretDisplay = computed<string>(() => props.modelValue.secret ?? '')

function onSecretInput(event: Event): void {
  const v = (event.target as HTMLInputElement).value
  const next = v.length > 0 ? v : undefined
  emit('update:modelValue', { secret: next })
}

function toggleSecret(): void {
  secretRevealed.value = !secretRevealed.value
}

// ----- guardrails --------------------------------------------------------

const ipv6Warning = computed<string | null>(() => {
  if (validateIpv6Enabled(props.modelValue.ipv6) === null) return null
  return t('pages.profile.guardrails.ipv6')
})

const externalControllerWarning = computed<string | null>(() => {
  if (
    validateExternalController(props.modelValue['external-controller'], props.modelValue.secret) ===
    null
  ) {
    return null
  }
  return t('pages.profile.guardrails.external_controller')
})

const interfaceNameWarning = computed<string | null>(() => {
  if (
    validateInterfaceNameVsAutoDetect(
      props.modelValue['interface-name'],
      props.tunAutoDetectInterface,
    ) === null
  ) {
    return null
  }
  return t('pages.profile.guardrails.interface_name_auto_detect')
})

// ----- dispatchers -------------------------------------------------------

function onToggle(key: keyof ProfileConfig, checked: boolean): void {
  emit('update:modelValue', { [key]: checked } as Partial<ProfileConfig>)
}

function onStringField(key: keyof ProfileConfig, value: string): void {
  const next = value.trim().length > 0 ? value : undefined
  emit('update:modelValue', { [key]: next } as Partial<ProfileConfig>)
}

function onNumberField(key: keyof ProfileConfig, value: string): void {
  if (value.trim().length === 0) {
    emit('update:modelValue', { [key]: undefined } as Partial<ProfileConfig>)
    return
  }
  const n = Number(value)
  if (!Number.isFinite(n)) return
  emit('update:modelValue', { [key]: n } as Partial<ProfileConfig>)
}

function onMode(event: Event): void {
  const v = (event.target as HTMLSelectElement).value as ProfileMode | ''
  emit('update:modelValue', { mode: v === '' ? undefined : v })
}

function onLogLevel(event: Event): void {
  const v = (event.target as HTMLSelectElement).value as ProfileLogLevel | ''
  emit('update:modelValue', { 'log-level': v === '' ? undefined : v })
}

function onFindProcessMode(event: Event): void {
  const v = (event.target as HTMLSelectElement).value as ProfileFindProcessMode | ''
  emit('update:modelValue', { 'find-process-mode': v === '' ? undefined : v })
}

function onAuthUpdate(list: string[]): void {
  emit('update:modelValue', { authentication: list.length > 0 ? list : undefined })
}

// ----- geox-url sub-section ----------------------------------------------

type GeoxUrlField = 'geoip' | 'geosite' | 'mmdb' | 'asn'
const GEOX_URL_FIELDS: readonly GeoxUrlField[] = ['geoip', 'geosite', 'mmdb', 'asn']

const geoxUrl = computed<GeoxUrlConfig>(() => props.modelValue['geox-url'] ?? {})

function onGeoxUrlField(field: GeoxUrlField, value: string): void {
  const trimmed = value.trim()
  const current = props.modelValue['geox-url'] ?? {}
  const next: GeoxUrlConfig = { ...current }
  if (trimmed.length === 0) {
    delete next[field]
  } else {
    next[field] = value
  }
  const stillHasSomething =
    next.geoip !== undefined ||
    next.geosite !== undefined ||
    next.mmdb !== undefined ||
    next.asn !== undefined ||
    (next.extras !== undefined && Object.keys(next.extras).length > 0)
  emit('update:modelValue', { 'geox-url': stillHasSomething ? next : undefined })
}

function onGeoxUrlReset(field: GeoxUrlField): void {
  onGeoxUrlField(field, '')
}

function geoxUrlError(field: GeoxUrlField): string | null {
  const v = geoxUrl.value[field]
  return validateGeoxUrlEntry(v)
}

// ----- nested profile sub-section ----------------------------------------

const nested = computed<ProfileNested>(() => props.modelValue.profile ?? {})

function onNestedToggle(key: keyof ProfileNested, checked: boolean): void {
  const current = props.modelValue.profile ?? {}
  const next: ProfileNested = { ...current, [key]: checked }
  // If both flags become undefined AND no extras — collapse to undefined so
  // the YAML key disappears. Here we only toggle booleans so we never unset;
  // deletion of the sub-section happens through raw YAML.
  emit('update:modelValue', { profile: next })
}

const modeValue = computed<ProfileMode | ''>(() => props.modelValue.mode ?? '')
const logLevelValue = computed<ProfileLogLevel | ''>(() => props.modelValue['log-level'] ?? '')
const findProcessModeValue = computed<ProfileFindProcessMode | ''>(
  () => props.modelValue['find-process-mode'] ?? '',
)
</script>

<template>
  <div class="space-y-6">
    <!-- General: mode, log-level, mixed-port, allow-lan, bind-address -->
    <section class="space-y-4 rounded-md border border-border bg-card/30 p-4">
      <h2 class="text-lg font-semibold">{{ t('pages.profile.sections.general') }}</h2>

      <div class="space-y-1">
        <label class="block text-xs font-medium uppercase text-muted-foreground" for="profile-mode">
          {{ t('pages.profile.fields.mode') }}
        </label>
        <select
          id="profile-mode"
          :value="modeValue"
          class="h-9 rounded-md border border-input bg-background px-2 text-sm"
          :aria-label="t('pages.profile.fields.mode')"
          data-testid="profile-mode"
          @change="onMode"
        >
          <option value="">—</option>
          <option value="rule">{{ t('pages.profile.mode.rule') }}</option>
          <option value="global">{{ t('pages.profile.mode.global') }}</option>
          <option value="direct">{{ t('pages.profile.mode.direct') }}</option>
        </select>
      </div>

      <div class="space-y-1">
        <label
          class="block text-xs font-medium uppercase text-muted-foreground"
          for="profile-log-level"
        >
          {{ t('pages.profile.fields.log_level') }}
        </label>
        <select
          id="profile-log-level"
          :value="logLevelValue"
          class="h-9 rounded-md border border-input bg-background px-2 text-sm"
          :aria-label="t('pages.profile.fields.log_level')"
          data-testid="profile-log-level"
          @change="onLogLevel"
        >
          <option value="">—</option>
          <option value="silent">silent</option>
          <option value="error">error</option>
          <option value="warning">warning</option>
          <option value="info">info</option>
          <option value="debug">debug</option>
        </select>
      </div>

      <div class="space-y-1">
        <label
          class="block text-xs font-medium uppercase text-muted-foreground"
          for="profile-mixed-port"
        >
          {{ t('pages.profile.fields.mixed_port') }}
        </label>
        <input
          id="profile-mixed-port"
          type="number"
          min="1"
          max="65535"
          :value="modelValue['mixed-port'] ?? ''"
          :placeholder="t('pages.profile.fields.mixed_port_placeholder')"
          class="h-9 w-32 rounded-md border border-input bg-background px-2 text-sm"
          :aria-label="t('pages.profile.fields.mixed_port')"
          data-testid="profile-mixed-port"
          @input="(e) => onNumberField('mixed-port', (e.target as HTMLInputElement).value)"
        />
      </div>

      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="h-4 w-4"
          :checked="modelValue['allow-lan'] ?? false"
          :aria-label="t('pages.profile.fields.allow_lan')"
          data-testid="profile-allow-lan"
          @change="(e) => onToggle('allow-lan', (e.target as HTMLInputElement).checked)"
        />
        {{ t('pages.profile.fields.allow_lan') }}
      </label>

      <div class="space-y-1">
        <label
          class="block text-xs font-medium uppercase text-muted-foreground"
          for="profile-bind-address"
        >
          {{ t('pages.profile.fields.bind_address') }}
        </label>
        <Input
          id="profile-bind-address"
          :model-value="modelValue['bind-address'] ?? ''"
          :placeholder="t('pages.profile.fields.bind_address_placeholder')"
          class="h-9"
          :aria-label="t('pages.profile.fields.bind_address')"
          data-testid="profile-bind-address"
          @update:model-value="(v: string | number) => onStringField('bind-address', String(v))"
        />
      </div>

      <!-- IPv6 with guardrail -->
      <div class="space-y-1">
        <label class="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            class="h-4 w-4"
            :checked="modelValue.ipv6 ?? false"
            :aria-label="t('pages.profile.fields.ipv6')"
            data-testid="profile-ipv6"
            @change="(e) => onToggle('ipv6', (e.target as HTMLInputElement).checked)"
          />
          {{ t('pages.profile.fields.ipv6') }}
        </label>
        <GuardrailPlate
          v-if="ipv6Warning"
          :message="ipv6Warning"
          data-testid="profile-ipv6-guardrail"
        />
      </div>

      <!-- interface-name: explicit outbound NIC bind. Mutually-exclusive-in-spirit
           with tun.auto-detect-interface — if both are set, interface-name wins
           but a guardrail plate reminds the operator. -->
      <div class="space-y-1">
        <label
          class="block text-xs font-medium uppercase text-muted-foreground"
          for="profile-interface-name"
        >
          {{ t('pages.profile.fields.interface_name') }}
        </label>
        <Input
          id="profile-interface-name"
          :model-value="modelValue['interface-name'] ?? ''"
          :placeholder="t('pages.profile.fields.interface_name_placeholder')"
          class="h-9"
          :aria-label="t('pages.profile.fields.interface_name')"
          data-testid="profile-interface-name"
          @update:model-value="(v: string | number) => onStringField('interface-name', String(v))"
        />
        <p class="text-xs text-muted-foreground">
          {{ t('pages.profile.fields.interface_name_hint') }}
        </p>
        <GuardrailPlate
          v-if="interfaceNameWarning"
          :message="interfaceNameWarning"
          data-testid="profile-interface-name-guardrail"
        />
      </div>
    </section>

    <!-- Control plane: external-controller + secret -->
    <section class="space-y-4 rounded-md border border-border bg-card/30 p-4">
      <h2 class="text-lg font-semibold">{{ t('pages.profile.sections.control_plane') }}</h2>

      <div class="space-y-1">
        <label
          class="block text-xs font-medium uppercase text-muted-foreground"
          for="profile-external-controller"
        >
          {{ t('pages.profile.fields.external_controller') }}
        </label>
        <Input
          id="profile-external-controller"
          :model-value="modelValue['external-controller'] ?? ''"
          :placeholder="t('pages.profile.fields.external_controller_placeholder')"
          class="h-9"
          :aria-label="t('pages.profile.fields.external_controller')"
          data-testid="profile-external-controller"
          @update:model-value="
            (v: string | number) => onStringField('external-controller', String(v))
          "
        />
        <p class="text-xs text-muted-foreground">
          {{ t('pages.profile.fields.external_controller_hint') }}
        </p>
        <GuardrailPlate
          v-if="externalControllerWarning"
          :message="externalControllerWarning"
          data-testid="profile-external-controller-guardrail"
        />
      </div>

      <!-- Secret with masked toggle -->
      <div class="space-y-1">
        <label
          class="block text-xs font-medium uppercase text-muted-foreground"
          for="profile-secret"
        >
          {{ t('pages.profile.fields.secret') }}
        </label>
        <div class="flex items-center gap-2">
          <input
            id="profile-secret"
            :type="secretRevealed ? 'text' : 'password'"
            :value="secretDisplay"
            :placeholder="t('pages.profile.fields.secret_placeholder')"
            class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 font-mono"
            :aria-label="t('pages.profile.fields.secret')"
            autocomplete="off"
            spellcheck="false"
            data-testid="profile-secret"
            @input="onSecretInput"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            :aria-label="
              secretRevealed
                ? t('pages.profile.fields.secret_hide')
                : t('pages.profile.fields.secret_show')
            "
            data-testid="profile-secret-toggle"
            @click="toggleSecret"
          >
            <EyeOff v-if="secretRevealed" class="h-4 w-4" />
            <Eye v-else class="h-4 w-4" />
          </Button>
        </div>
        <GuardrailPlate
          :message="t('pages.profile.guardrails.secret')"
          data-testid="profile-secret-guardrail"
        />
      </div>

      <!-- Dashboard assets -->
      <div class="space-y-1">
        <label
          class="block text-xs font-medium uppercase text-muted-foreground"
          for="profile-external-ui"
        >
          {{ t('pages.profile.fields.external_ui') }}
        </label>
        <Input
          id="profile-external-ui"
          :model-value="modelValue['external-ui'] ?? ''"
          :placeholder="t('pages.profile.fields.external_ui_placeholder')"
          class="h-9"
          :aria-label="t('pages.profile.fields.external_ui')"
          data-testid="profile-external-ui"
          @update:model-value="(v: string | number) => onStringField('external-ui', String(v))"
        />
      </div>

      <div class="space-y-1">
        <label
          class="block text-xs font-medium uppercase text-muted-foreground"
          for="profile-external-ui-name"
        >
          {{ t('pages.profile.fields.external_ui_name') }}
        </label>
        <Input
          id="profile-external-ui-name"
          :model-value="modelValue['external-ui-name'] ?? ''"
          class="h-9"
          :aria-label="t('pages.profile.fields.external_ui_name')"
          data-testid="profile-external-ui-name"
          @update:model-value="(v: string | number) => onStringField('external-ui-name', String(v))"
        />
      </div>

      <div class="space-y-1">
        <label
          class="block text-xs font-medium uppercase text-muted-foreground"
          for="profile-external-ui-url"
        >
          {{ t('pages.profile.fields.external_ui_url') }}
        </label>
        <Input
          id="profile-external-ui-url"
          :model-value="modelValue['external-ui-url'] ?? ''"
          class="h-9"
          :aria-label="t('pages.profile.fields.external_ui_url')"
          data-testid="profile-external-ui-url"
          @update:model-value="(v: string | number) => onStringField('external-ui-url', String(v))"
        />
      </div>
    </section>

    <!-- Behavior: tcp-concurrent, unified-delay, find-process-mode, fingerprint -->
    <section class="space-y-4 rounded-md border border-border bg-card/30 p-4">
      <h2 class="text-lg font-semibold">{{ t('pages.profile.sections.behavior') }}</h2>

      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="h-4 w-4"
          :checked="modelValue['tcp-concurrent'] ?? false"
          :aria-label="t('pages.profile.fields.tcp_concurrent')"
          data-testid="profile-tcp-concurrent"
          @change="(e) => onToggle('tcp-concurrent', (e.target as HTMLInputElement).checked)"
        />
        {{ t('pages.profile.fields.tcp_concurrent') }}
      </label>

      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="h-4 w-4"
          :checked="modelValue['unified-delay'] ?? false"
          :aria-label="t('pages.profile.fields.unified_delay')"
          data-testid="profile-unified-delay"
          @change="(e) => onToggle('unified-delay', (e.target as HTMLInputElement).checked)"
        />
        {{ t('pages.profile.fields.unified_delay') }}
      </label>

      <div class="space-y-1">
        <label
          class="block text-xs font-medium uppercase text-muted-foreground"
          for="profile-find-process-mode"
        >
          {{ t('pages.profile.fields.find_process_mode') }}
        </label>
        <select
          id="profile-find-process-mode"
          :value="findProcessModeValue"
          class="h-9 rounded-md border border-input bg-background px-2 text-sm"
          :aria-label="t('pages.profile.fields.find_process_mode')"
          data-testid="profile-find-process-mode"
          @change="onFindProcessMode"
        >
          <option value="">—</option>
          <option value="off">off</option>
          <option value="strict">strict</option>
          <option value="always">always</option>
        </select>
      </div>

      <div class="space-y-1">
        <label
          class="block text-xs font-medium uppercase text-muted-foreground"
          for="profile-fingerprint"
        >
          {{ t('pages.profile.fields.global_client_fingerprint') }}
        </label>
        <Input
          id="profile-fingerprint"
          :model-value="modelValue['global-client-fingerprint'] ?? ''"
          :placeholder="t('pages.profile.fields.global_client_fingerprint_placeholder')"
          class="h-9"
          :aria-label="t('pages.profile.fields.global_client_fingerprint')"
          data-testid="profile-fingerprint"
          @update:model-value="
            (v: string | number) => onStringField('global-client-fingerprint', String(v))
          "
        />
      </div>

      <div class="space-y-1">
        <label
          class="block text-xs font-medium uppercase text-muted-foreground"
          for="profile-keep-alive-interval"
        >
          {{ t('pages.profile.fields.keep_alive_interval') }}
        </label>
        <input
          id="profile-keep-alive-interval"
          type="number"
          min="1"
          :value="modelValue['keep-alive-interval'] ?? ''"
          class="h-9 w-32 rounded-md border border-input bg-background px-2 text-sm"
          :aria-label="t('pages.profile.fields.keep_alive_interval')"
          data-testid="profile-keep-alive-interval"
          @input="(e) => onNumberField('keep-alive-interval', (e.target as HTMLInputElement).value)"
        />
      </div>
    </section>

    <!-- Geo data -->
    <section class="space-y-4 rounded-md border border-border bg-card/30 p-4">
      <h2 class="text-lg font-semibold">{{ t('pages.profile.sections.geo') }}</h2>

      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="h-4 w-4"
          :checked="modelValue['geodata-mode'] ?? false"
          :aria-label="t('pages.profile.fields.geodata_mode')"
          data-testid="profile-geodata-mode"
          @change="(e) => onToggle('geodata-mode', (e.target as HTMLInputElement).checked)"
        />
        {{ t('pages.profile.fields.geodata_mode') }}
      </label>

      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="h-4 w-4"
          :checked="modelValue['geo-auto-update'] ?? false"
          :aria-label="t('pages.profile.fields.geo_auto_update')"
          data-testid="profile-geo-auto-update"
          @change="(e) => onToggle('geo-auto-update', (e.target as HTMLInputElement).checked)"
        />
        {{ t('pages.profile.fields.geo_auto_update') }}
      </label>

      <div class="space-y-1">
        <label
          class="block text-xs font-medium uppercase text-muted-foreground"
          for="profile-geo-update-interval"
        >
          {{ t('pages.profile.fields.geo_update_interval') }}
        </label>
        <input
          id="profile-geo-update-interval"
          type="number"
          min="1"
          :value="modelValue['geo-update-interval'] ?? ''"
          class="h-9 w-32 rounded-md border border-input bg-background px-2 text-sm"
          :aria-label="t('pages.profile.fields.geo_update_interval')"
          data-testid="profile-geo-update-interval"
          @input="(e) => onNumberField('geo-update-interval', (e.target as HTMLInputElement).value)"
        />
        <p class="text-xs text-muted-foreground">
          {{ t('pages.profile.fields.geo_update_interval_hint') }}
        </p>
      </div>

      <!-- GeoX URL overrides: geoip / geosite / mmdb / asn -->
      <div
        class="space-y-3 rounded-md border border-dashed border-border p-3"
        data-testid="profile-geox-url"
      >
        <header class="space-y-1">
          <h3 class="text-sm font-semibold">{{ t('pages.profile.sections.geox_url') }}</h3>
          <p class="text-xs text-muted-foreground">{{ t('pages.profile.geox_url.description') }}</p>
        </header>
        <div v-for="field in GEOX_URL_FIELDS" :key="field" class="space-y-1">
          <label
            class="block text-xs font-medium uppercase text-muted-foreground"
            :for="`profile-geox-url-${field}`"
          >
            {{ t(`pages.profile.fields.geox_url_${field}`) }}
          </label>
          <div class="flex items-center gap-2">
            <Input
              :id="`profile-geox-url-${field}`"
              :model-value="geoxUrl[field] ?? ''"
              :placeholder="t(`pages.profile.fields.geox_url_${field}_placeholder`)"
              class="h-9 flex-1"
              :aria-label="t(`pages.profile.fields.geox_url_${field}`)"
              :data-testid="`profile-geox-url-${field}`"
              @update:model-value="(v: string | number) => onGeoxUrlField(field, String(v))"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              :disabled="geoxUrl[field] === undefined || geoxUrl[field] === ''"
              :aria-label="t('pages.profile.geox_url.reset', { field })"
              :data-testid="`profile-geox-url-${field}-reset`"
              @click="onGeoxUrlReset(field)"
            >
              {{ t('pages.profile.geox_url.reset_label') }}
            </Button>
          </div>
          <p
            v-if="geoxUrlError(field)"
            class="text-xs text-destructive"
            :data-testid="`profile-geox-url-${field}-error`"
          >
            {{ t('pages.profile.geox_url.invalid_url') }}
          </p>
        </div>
      </div>
    </section>

    <!-- Nested profile sub-section: store-selected / store-fake-ip -->
    <section class="space-y-4 rounded-md border border-border bg-card/30 p-4">
      <h2 class="text-lg font-semibold">{{ t('pages.profile.sections.profile_nested') }}</h2>
      <p class="text-xs text-muted-foreground">{{ t('pages.profile.nested.description') }}</p>

      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="h-4 w-4"
          :checked="nested['store-selected'] ?? false"
          :aria-label="t('pages.profile.fields.store_selected')"
          data-testid="profile-store-selected"
          @change="(e) => onNestedToggle('store-selected', (e.target as HTMLInputElement).checked)"
        />
        {{ t('pages.profile.fields.store_selected') }}
      </label>

      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="h-4 w-4"
          :checked="nested['store-fake-ip'] ?? false"
          :aria-label="t('pages.profile.fields.store_fake_ip')"
          data-testid="profile-store-fake-ip"
          @change="(e) => onNestedToggle('store-fake-ip', (e.target as HTMLInputElement).checked)"
        />
        {{ t('pages.profile.fields.store_fake_ip') }}
      </label>
    </section>

    <!-- Authentication -->
    <section class="space-y-3 rounded-md border border-border bg-card/30 p-4">
      <h2 class="text-lg font-semibold">{{ t('pages.profile.sections.authentication') }}</h2>
      <p class="text-xs text-muted-foreground">{{ t('pages.profile.auth.description') }}</p>
      <GuardrailPlate
        :message="t('pages.profile.guardrails.authentication')"
        data-testid="profile-auth-guardrail"
      />
      <AuthList :model-value="modelValue.authentication ?? []" @update:model-value="onAuthUpdate" />
    </section>
  </div>
</template>
