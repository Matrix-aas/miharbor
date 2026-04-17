<script setup lang="ts">
// TunConfigForm — the non-list fields of the TUN section (enable, device,
// stack, auto-*, strict-route, mtu, endpoint-independent-nat,
// interface-name). The list fields (dns-hijack, route-*-address,
// inet[46]-address, exclude-interface) are handled by sibling components
// (RouteExcludeList for the cross-referenced case, NameserverList for the
// simple lists).
//
// Emits a full Partial<TunConfig> patch per change — Tun.vue merges the
// slice and pushes the whole TunConfig down to setTunConfigDraft.

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TunConfig, TunStack } from 'miharbor-shared'
import { validateTunDevice } from 'miharbor-shared'
import { Input } from '@/components/ui/input'
import GuardrailPlate from '@/components/ui/GuardrailPlate.vue'

interface Props {
  modelValue: TunConfig
}

const props = defineProps<Props>()
const emit = defineEmits<{ 'update:modelValue': [patch: Partial<TunConfig>] }>()

const { t } = useI18n()

const deviceWarning = computed<string | null>(() => {
  if (validateTunDevice(props.modelValue.device) === null) return null
  return t('pages.tun.guardrails.device_empty')
})

const autoDetectWarning = computed<string | null>(() => {
  if (props.modelValue['auto-detect-interface'] !== true) return null
  return t('pages.tun.guardrails.auto_detect')
})

const stackValue = computed<TunStack | ''>(() => props.modelValue.stack ?? '')

function onToggle(key: keyof TunConfig, checked: boolean): void {
  emit('update:modelValue', { [key]: checked } as Partial<TunConfig>)
}

function onStringField(key: keyof TunConfig, value: string): void {
  const next = value.trim().length > 0 ? value : undefined
  emit('update:modelValue', { [key]: next } as Partial<TunConfig>)
}

function onStack(event: Event): void {
  const v = (event.target as HTMLSelectElement).value as TunStack | ''
  emit('update:modelValue', { stack: v === '' ? undefined : v })
}

function onMtu(event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  if (raw.trim().length === 0) {
    emit('update:modelValue', { mtu: undefined })
    return
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return
  emit('update:modelValue', { mtu: n })
}
</script>

<template>
  <div class="space-y-4">
    <label class="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        class="h-4 w-4"
        :checked="modelValue.enable ?? false"
        :aria-label="t('pages.tun.fields.enable')"
        data-testid="tun-enable"
        @change="(e) => onToggle('enable', (e.target as HTMLInputElement).checked)"
      />
      {{ t('pages.tun.fields.enable') }}
    </label>

    <!-- Device — guardrail when empty -->
    <div class="space-y-1">
      <label class="block text-xs font-medium uppercase text-muted-foreground" for="tun-device">
        {{ t('pages.tun.fields.device') }}
      </label>
      <Input
        id="tun-device"
        :model-value="modelValue.device ?? ''"
        :placeholder="t('pages.tun.fields.device_placeholder')"
        class="h-9"
        :aria-label="t('pages.tun.fields.device')"
        data-testid="tun-device"
        @update:model-value="(v: string | number) => onStringField('device', String(v))"
      />
      <p class="text-xs text-muted-foreground">
        {{ t('pages.tun.fields.device_hint') }}
      </p>
      <GuardrailPlate
        v-if="deviceWarning"
        :message="deviceWarning"
        data-testid="tun-device-guardrail"
      />
    </div>

    <!-- Stack selector -->
    <div class="space-y-1">
      <label class="block text-xs font-medium uppercase text-muted-foreground" for="tun-stack">
        {{ t('pages.tun.fields.stack') }}
      </label>
      <select
        id="tun-stack"
        :value="stackValue"
        class="h-9 rounded-md border border-input bg-background px-2 text-sm"
        :aria-label="t('pages.tun.fields.stack')"
        data-testid="tun-stack"
        @change="onStack"
      >
        <option value="">—</option>
        <option value="system">{{ t('pages.tun.stack.system') }}</option>
        <option value="gvisor">{{ t('pages.tun.stack.gvisor') }}</option>
        <option value="mixed">{{ t('pages.tun.stack.mixed') }}</option>
      </select>
      <p class="text-xs text-muted-foreground">
        {{ t('pages.tun.fields.stack_hint') }}
      </p>
    </div>

    <!-- MTU -->
    <div class="space-y-1">
      <label class="block text-xs font-medium uppercase text-muted-foreground" for="tun-mtu">
        {{ t('pages.tun.fields.mtu') }}
      </label>
      <input
        id="tun-mtu"
        type="number"
        min="1"
        :value="modelValue.mtu ?? ''"
        :placeholder="t('pages.tun.fields.mtu_placeholder')"
        class="h-9 w-32 rounded-md border border-input bg-background px-2 text-sm"
        :aria-label="t('pages.tun.fields.mtu')"
        data-testid="tun-mtu"
        @input="onMtu"
      />
    </div>

    <!-- Routing flags -->
    <div class="space-y-2">
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="h-4 w-4"
          :checked="modelValue['auto-route'] ?? false"
          :aria-label="t('pages.tun.fields.auto_route')"
          data-testid="tun-auto-route"
          @change="(e) => onToggle('auto-route', (e.target as HTMLInputElement).checked)"
        />
        {{ t('pages.tun.fields.auto_route') }}
      </label>

      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="h-4 w-4"
          :checked="modelValue['auto-redirect'] ?? false"
          :aria-label="t('pages.tun.fields.auto_redirect')"
          data-testid="tun-auto-redirect"
          @change="(e) => onToggle('auto-redirect', (e.target as HTMLInputElement).checked)"
        />
        {{ t('pages.tun.fields.auto_redirect') }}
      </label>

      <div class="space-y-1">
        <label class="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            class="h-4 w-4"
            :checked="modelValue['auto-detect-interface'] ?? false"
            :aria-label="t('pages.tun.fields.auto_detect_interface')"
            data-testid="tun-auto-detect-interface"
            @change="
              (e) => onToggle('auto-detect-interface', (e.target as HTMLInputElement).checked)
            "
          />
          {{ t('pages.tun.fields.auto_detect_interface') }}
        </label>
        <GuardrailPlate
          v-if="autoDetectWarning"
          :message="autoDetectWarning"
          data-testid="tun-auto-detect-guardrail"
        />
      </div>

      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="h-4 w-4"
          :checked="modelValue['strict-route'] ?? false"
          :aria-label="t('pages.tun.fields.strict_route')"
          data-testid="tun-strict-route"
          @change="(e) => onToggle('strict-route', (e.target as HTMLInputElement).checked)"
        />
        {{ t('pages.tun.fields.strict_route') }}
      </label>

      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="h-4 w-4"
          :checked="modelValue['endpoint-independent-nat'] ?? false"
          :aria-label="t('pages.tun.fields.endpoint_independent_nat')"
          data-testid="tun-endpoint-independent-nat"
          @change="
            (e) => onToggle('endpoint-independent-nat', (e.target as HTMLInputElement).checked)
          "
        />
        {{ t('pages.tun.fields.endpoint_independent_nat') }}
      </label>
    </div>

    <!-- Interface-name (explicit) -->
    <div class="space-y-1">
      <label
        class="block text-xs font-medium uppercase text-muted-foreground"
        for="tun-interface-name"
      >
        {{ t('pages.tun.fields.interface_name') }}
      </label>
      <Input
        id="tun-interface-name"
        :model-value="modelValue['interface-name'] ?? ''"
        :placeholder="t('pages.tun.fields.interface_name_placeholder')"
        class="h-9"
        :aria-label="t('pages.tun.fields.interface_name')"
        data-testid="tun-interface-name"
        @update:model-value="(v: string | number) => onStringField('interface-name', String(v))"
      />
      <p class="text-xs text-muted-foreground">
        {{ t('pages.tun.fields.interface_name_hint') }}
      </p>
    </div>
  </div>
</template>
