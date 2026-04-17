<script setup lang="ts">
// WireGuardForm — add/edit form for a single WireGuard proxy node.
//
// Notes:
//   * Secrets (private-key, pre-shared-key) render as `type="password"` by
//     default; a small "eye" toggle reveals the value for copy/paste.
//   * `amnezia-wg-option` is an expandable section — operators who don't
//     run Amnezia leave it empty. The warning in the section header reminds
//     them the values MUST match the server's `.awg-params`.
//   * Validation is intentionally minimal — the server linter provides the
//     authoritative check; we just surface obvious omissions locally.

import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-vue-next'
import type { WireGuardNode } from 'miharbor-shared'
import { WIREGUARD_PRE_SHARED_KEY_SENTINEL, WIREGUARD_PRIVATE_KEY_SENTINEL } from 'miharbor-shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isValidWireGuardKey } from '@/lib/rule-validation'

interface Props {
  /** When set, form opens in edit mode (name field disabled). */
  initial?: WireGuardNode
  /** For uniqueness check on create. */
  existingNames: string[]
}
const props = defineProps<Props>()
const emit = defineEmits<{ submit: [node: WireGuardNode]; cancel: [] }>()

const { t } = useI18n()

const editing = computed(() => Boolean(props.initial))

const name = ref<string>(props.initial?.name ?? '')
const server = ref<string>(props.initial?.server ?? '')
const port = ref<number>(props.initial?.port ?? 51820)
const ip = ref<string>(props.initial?.ip ?? '10.0.0.2/32')
const privateKey = ref<string>(props.initial?.['private-key'] ?? '')
const publicKey = ref<string>(props.initial?.['public-key'] ?? '')
const preSharedKey = ref<string>(props.initial?.['pre-shared-key'] ?? '')
const dns = ref<string>((props.initial?.dns ?? []).join('\n'))
const allowedIps = ref<string>((props.initial?.['allowed-ips'] ?? ['0.0.0.0/0']).join('\n'))
const keepalive = ref<number>(props.initial?.['persistent-keepalive'] ?? 15)
const udp = ref<boolean>(props.initial?.udp ?? true)

const showPrivate = ref(false)
const showPsk = ref(false)

/** `true` when the form's current `private-key` is still the server-side
 *  sentinel, i.e. the operator hasn't rotated the key since load. The UI
 *  disables the reveal-eye in that case — there is nothing to reveal —
 *  and the submit handler knows to round-trip the sentinel unchanged so
 *  the deploy pipeline substitutes the real on-disk value back. */
const privateKeyIsSentinel = computed<boolean>(
  () => privateKey.value === WIREGUARD_PRIVATE_KEY_SENTINEL,
)
const preSharedKeyIsSentinel = computed<boolean>(
  () => preSharedKey.value === WIREGUARD_PRE_SHARED_KEY_SENTINEL,
)

// Amnezia section — pre-fill from initial.
const amneziaOpen = ref<boolean>(Boolean(props.initial?.['amnezia-wg-option']))
const awg = ref<Record<string, number | null>>({
  jc: props.initial?.['amnezia-wg-option']?.jc ?? null,
  jmin: props.initial?.['amnezia-wg-option']?.jmin ?? null,
  jmax: props.initial?.['amnezia-wg-option']?.jmax ?? null,
  s1: props.initial?.['amnezia-wg-option']?.s1 ?? null,
  s2: props.initial?.['amnezia-wg-option']?.s2 ?? null,
  h1: props.initial?.['amnezia-wg-option']?.h1 ?? null,
  h2: props.initial?.['amnezia-wg-option']?.h2 ?? null,
  h3: props.initial?.['amnezia-wg-option']?.h3 ?? null,
  h4: props.initial?.['amnezia-wg-option']?.h4 ?? null,
})

watch(
  () => props.initial,
  (next) => {
    if (!next) return
    name.value = next.name
    server.value = next.server
    port.value = next.port
    ip.value = next.ip
    privateKey.value = next['private-key']
    publicKey.value = next['public-key']
    preSharedKey.value = next['pre-shared-key'] ?? ''
    dns.value = (next.dns ?? []).join('\n')
    allowedIps.value = (next['allowed-ips'] ?? ['0.0.0.0/0']).join('\n')
    keepalive.value = next['persistent-keepalive'] ?? 15
    udp.value = next.udp ?? true
    amneziaOpen.value = Boolean(next['amnezia-wg-option'])
    const opt = next['amnezia-wg-option']
    awg.value = {
      jc: opt?.jc ?? null,
      jmin: opt?.jmin ?? null,
      jmax: opt?.jmax ?? null,
      s1: opt?.s1 ?? null,
      s2: opt?.s2 ?? null,
      h1: opt?.h1 ?? null,
      h2: opt?.h2 ?? null,
      h3: opt?.h3 ?? null,
      h4: opt?.h4 ?? null,
    }
  },
)

const nameError = computed<string | null>(() => {
  const trimmed = name.value.trim()
  if (trimmed.length === 0) return t('proxies.wireguard.name_required')
  if (!editing.value && props.existingNames.includes(trimmed)) {
    return t('proxies.wireguard.name_taken')
  }
  return null
})

const privateKeyError = computed<string | null>(() => {
  if (privateKey.value.length === 0) return t('proxies.wireguard.name_required')
  return isValidWireGuardKey(privateKey.value) ? null : t('proxies.wireguard.key_invalid')
})

const publicKeyError = computed<string | null>(() => {
  if (publicKey.value.length === 0) return t('proxies.wireguard.name_required')
  return isValidWireGuardKey(publicKey.value) ? null : t('proxies.wireguard.key_invalid')
})

const canSubmit = computed<boolean>(
  () =>
    nameError.value === null &&
    privateKeyError.value === null &&
    publicKeyError.value === null &&
    server.value.trim().length > 0 &&
    ip.value.trim().length > 0 &&
    Number.isFinite(port.value) &&
    port.value > 0 &&
    port.value <= 65535,
)

function toLineList(s: string): string[] {
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

function buildAmneziaOption(): Record<string, number> | null {
  const entries = Object.entries(awg.value).filter(([, v]) => v !== null && Number.isFinite(v))
  if (entries.length === 0) return null
  const out: Record<string, number> = {}
  for (const [k, v] of entries) out[k] = v as number
  return out
}

function onSubmit(): void {
  if (!canSubmit.value) return
  const node: WireGuardNode = {
    name: name.value.trim(),
    type: 'wireguard',
    server: server.value.trim(),
    port: Math.floor(port.value),
    ip: ip.value.trim(),
    'private-key': privateKey.value.trim(),
    'public-key': publicKey.value.trim(),
  }
  if (preSharedKey.value.trim().length > 0) {
    node['pre-shared-key'] = preSharedKey.value.trim()
  }
  const dnsList = toLineList(dns.value)
  if (dnsList.length > 0) node.dns = dnsList
  const allowed = toLineList(allowedIps.value)
  if (allowed.length > 0) node['allowed-ips'] = allowed
  if (Number.isFinite(keepalive.value)) node['persistent-keepalive'] = Math.floor(keepalive.value)
  if (typeof udp.value === 'boolean') node.udp = udp.value
  const amneziaOption = buildAmneziaOption()
  if (amneziaOption !== null) node['amnezia-wg-option'] = amneziaOption
  emit('submit', node)
}

const awgKeys: Array<keyof typeof awg.value> = [
  'jc',
  'jmin',
  'jmax',
  's1',
  's2',
  'h1',
  'h2',
  'h3',
  'h4',
]

// Stable per-instance id prefix so <label for> / <input id> pairs line up
// for screen readers. Vue 3.5 `useId` returns an SSR-safe unique string.
const uid = useId()
const ids = {
  name: `${uid}-name`,
  server: `${uid}-server`,
  port: `${uid}-port`,
  ip: `${uid}-ip`,
  privateKey: `${uid}-pk`,
  publicKey: `${uid}-pub`,
  preSharedKey: `${uid}-psk`,
  dns: `${uid}-dns`,
  allowedIps: `${uid}-allowed`,
  keepalive: `${uid}-keep`,
  udp: `${uid}-udp`,
}
</script>

<template>
  <form class="space-y-4" data-testid="wireguard-form" @submit.prevent="onSubmit">
    <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div>
        <label :for="ids.name" class="mb-1 block text-xs font-medium text-muted-foreground">
          {{ t('proxies.wireguard.name') }}
        </label>
        <Input :id="ids.name" v-model="name" :disabled="editing" class="h-9" />
        <p v-if="nameError && name.length > 0" class="mt-1 text-xs text-destructive">
          {{ nameError }}
        </p>
      </div>
      <div>
        <label :for="ids.server" class="mb-1 block text-xs font-medium text-muted-foreground">
          {{ t('proxies.wireguard.server') }}
        </label>
        <Input :id="ids.server" v-model="server" class="h-9" />
      </div>
      <div>
        <label :for="ids.port" class="mb-1 block text-xs font-medium text-muted-foreground">
          {{ t('proxies.wireguard.port') }}
        </label>
        <Input :id="ids.port" v-model.number="port" type="number" class="h-9" />
      </div>
      <div>
        <label :for="ids.ip" class="mb-1 block text-xs font-medium text-muted-foreground">
          {{ t('proxies.wireguard.ip') }}
        </label>
        <Input :id="ids.ip" v-model="ip" class="h-9 font-mono" />
      </div>
    </div>

    <div>
      <label :for="ids.privateKey" class="mb-1 block text-xs font-medium text-muted-foreground">
        {{ t('proxies.wireguard.private_key') }}
      </label>
      <div class="flex gap-2">
        <Input
          :id="ids.privateKey"
          v-model="privateKey"
          :type="showPrivate && !privateKeyIsSentinel ? 'text' : 'password'"
          class="h-9 font-mono"
          data-testid="wireguard-private-key"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          class="h-9 w-9"
          :disabled="privateKeyIsSentinel"
          :title="showPrivate ? t('common.hide') : t('common.show')"
          :aria-label="showPrivate ? t('common.hide') : t('common.show')"
          @click="
            () => {
              if (privateKeyIsSentinel) return
              showPrivate = !showPrivate
            }
          "
        >
          <component :is="showPrivate && !privateKeyIsSentinel ? EyeOff : Eye" class="h-4 w-4" />
        </Button>
      </div>
      <p
        v-if="privateKeyIsSentinel"
        class="mt-1 text-xs text-muted-foreground"
        data-testid="wireguard-private-key-sentinel-hint"
      >
        {{ t('proxies.wireguard.key_sentinel_hint') }}
      </p>
      <p v-if="privateKeyError && privateKey.length > 0" class="mt-1 text-xs text-destructive">
        {{ privateKeyError }}
      </p>
    </div>

    <div>
      <label :for="ids.publicKey" class="mb-1 block text-xs font-medium text-muted-foreground">
        {{ t('proxies.wireguard.public_key') }}
      </label>
      <Input :id="ids.publicKey" v-model="publicKey" class="h-9 font-mono" />
      <p v-if="publicKeyError && publicKey.length > 0" class="mt-1 text-xs text-destructive">
        {{ publicKeyError }}
      </p>
    </div>

    <div>
      <label :for="ids.preSharedKey" class="mb-1 block text-xs font-medium text-muted-foreground">
        {{ t('proxies.wireguard.pre_shared_key') }}
      </label>
      <div class="flex gap-2">
        <Input
          :id="ids.preSharedKey"
          v-model="preSharedKey"
          :type="showPsk && !preSharedKeyIsSentinel ? 'text' : 'password'"
          class="h-9 font-mono"
          data-testid="wireguard-pre-shared-key"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          class="h-9 w-9"
          :disabled="preSharedKeyIsSentinel"
          :title="showPsk ? t('common.hide') : t('common.show')"
          :aria-label="showPsk ? t('common.hide') : t('common.show')"
          @click="
            () => {
              if (preSharedKeyIsSentinel) return
              showPsk = !showPsk
            }
          "
        >
          <component :is="showPsk && !preSharedKeyIsSentinel ? EyeOff : Eye" class="h-4 w-4" />
        </Button>
      </div>
      <p
        v-if="preSharedKeyIsSentinel"
        class="mt-1 text-xs text-muted-foreground"
        data-testid="wireguard-pre-shared-key-sentinel-hint"
      >
        {{ t('proxies.wireguard.key_sentinel_hint') }}
      </p>
    </div>

    <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div>
        <label :for="ids.dns" class="mb-1 block text-xs font-medium text-muted-foreground">
          {{ t('proxies.wireguard.dns') }}
        </label>
        <textarea
          :id="ids.dns"
          v-model="dns"
          rows="3"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
        />
      </div>
      <div>
        <label :for="ids.allowedIps" class="mb-1 block text-xs font-medium text-muted-foreground">
          {{ t('proxies.wireguard.allowed_ips') }}
        </label>
        <textarea
          :id="ids.allowedIps"
          v-model="allowedIps"
          rows="3"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
        />
      </div>
    </div>

    <div class="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
      <div>
        <label :for="ids.keepalive" class="mb-1 block text-xs font-medium text-muted-foreground">
          {{ t('proxies.wireguard.persistent_keepalive') }}
        </label>
        <Input :id="ids.keepalive" v-model.number="keepalive" type="number" class="h-9" />
      </div>
      <div class="flex items-end">
        <label
          :for="ids.udp"
          class="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <input :id="ids.udp" v-model="udp" type="checkbox" class="h-4 w-4" />
          {{ t('proxies.wireguard.udp') }}
        </label>
      </div>
    </div>

    <!-- Amnezia-WG section -->
    <div class="rounded-md border border-border bg-card/30">
      <button
        type="button"
        class="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium"
        @click="amneziaOpen = !amneziaOpen"
      >
        <component :is="amneziaOpen ? ChevronDown : ChevronRight" class="h-4 w-4" />
        {{ t('proxies.wireguard.amnezia_section') }}
      </button>
      <div v-if="amneziaOpen" class="space-y-3 border-t border-border px-3 py-3">
        <p
          class="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400"
        >
          <AlertTriangle class="h-4 w-4 shrink-0" />
          {{ t('proxies.wireguard.amnezia_hint') }}
        </p>
        <div class="grid grid-cols-3 gap-2">
          <div v-for="k in awgKeys" :key="k">
            <label
              :for="`${uid}-awg-${k}`"
              class="mb-1 block text-[10px] uppercase text-muted-foreground"
              >{{ k }}</label
            >
            <Input
              :id="`${uid}-awg-${k}`"
              :model-value="awg[k] ?? ''"
              type="number"
              class="h-9"
              @update:model-value="
                (v: string | number) => (awg[k] = v === '' || v === null ? null : Number(v))
              "
            />
          </div>
        </div>
      </div>
    </div>

    <div class="flex justify-end gap-2">
      <Button type="button" variant="ghost" size="sm" @click="emit('cancel')">
        {{ t('common.cancel') }}
      </Button>
      <Button type="submit" size="sm" :disabled="!canSubmit">
        {{ t('proxies.wireguard.save') }}
      </Button>
    </div>
  </form>
</template>
