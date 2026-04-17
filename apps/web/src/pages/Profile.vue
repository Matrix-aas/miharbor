<script setup lang="ts">
// Profile page — structured editor for the top-level mihomo scalars that
// don't belong to one of the nested sections (dns / tun / sniffer). Mirrors
// Dns.vue / Tun.vue / Sniffer.vue in wiring:
//   1. configStore.loadAll() pulls the draft on mount.
//   2. `configStore.profileConfig` derives the typed view from the draft
//      Document (see apps/web/src/lib/profile-view.ts — mirror of the
//      server projection).
//   3. ProfileForm emits partial patches up here; we merge and call
//      `configStore.setProfileConfigDraft`.
//   4. That mutator rewrites only the keys we own; reserved sections
//      (dns/tun/sniffer/rules/…) are preserved verbatim.
//
// Security-sensitive pieces:
//   * `secret:` is masked by default — the form owns its reveal state
//     locally so navigating away re-masks.
//   * `authentication:` only shows usernames; password edits go through a
//     dialog that never echoes the stored password.
//   * No field values are ever logged (console.error falls back to the
//     error message alone; the store's setProfileConfigDraft does not
//     stringify the config in any diagnostic).

import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ProfileConfig } from 'miharbor-shared'
import { useConfigStore } from '@/stores/config'
import ProfileForm from '@/components/profile/ProfileForm.vue'

const { t } = useI18n()
const config = useConfigStore()

onMounted(() => {
  void config.loadAll()
})

const profile = computed<ProfileConfig>(() => config.profileConfig)

/** Read `tun.auto-detect-interface` from the draft so the ProfileForm can
 *  surface the cross-section guardrail when both explicit `interface-name`
 *  and tun auto-detect are enabled. Defaults to `false` when TUN section
 *  is absent. */
const tunAutoDetectInterface = computed<boolean>(
  () => config.tunConfig['auto-detect-interface'] === true,
)

function emitPatch(patch: Partial<ProfileConfig>): void {
  const merged: ProfileConfig = { ...profile.value, ...patch }
  for (const k of Object.keys(patch) as (keyof ProfileConfig)[]) {
    if (patch[k] === undefined) {
      delete (merged as Record<string, unknown>)[k]
    }
  }
  void config.setProfileConfigDraft(merged).catch((e) => {
    // Do NOT include the profile value in the log — `secret:` would leak.
    console.error('setProfileConfigDraft failed:', (e as Error).message)
  })
}

const extras = computed<Record<string, unknown> | null>(() => {
  const e = profile.value.extras
  if (!e || Object.keys(e).length === 0) return null
  return e
})
</script>

<template>
  <section class="space-y-6" data-testid="profile-page">
    <header class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight">{{ t('pages.profile.title') }}</h1>
      <p class="text-sm text-muted-foreground">{{ t('pages.profile.subtitle') }}</p>
    </header>

    <ProfileForm
      :model-value="profile"
      :tun-auto-detect-interface="tunAutoDetectInterface"
      @update:model-value="emitPatch"
    />

    <!-- Preserved unknown top-level keys (not managed by any section view). -->
    <section
      v-if="extras"
      class="space-y-2 rounded-md border border-dashed border-border bg-card/20 p-4"
      data-testid="profile-extras"
    >
      <h2 class="text-sm font-medium uppercase text-muted-foreground">
        {{ t('pages.profile.sections.extras') }}
      </h2>
      <p class="text-xs text-muted-foreground">{{ t('pages.profile.extras.note') }}</p>
      <ul class="text-xs font-mono">
        <li v-for="k in Object.keys(extras)" :key="k">{{ k }}</li>
      </ul>
    </section>
  </section>
</template>
