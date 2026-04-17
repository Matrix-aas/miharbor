<script setup lang="ts">
// YamlValidityGuard — wraps <RouterView> and blocks *structural* routes
// when the draft YAML fails to parse (Task 39 AC #3).
//
// The block is route-scoped: structural pages (Services, Proxies, DNS, TUN,
// Sniffer, Profile, Providers) swap their body for a banner with a "Open
// Raw YAML" link. Non-structural pages (History, Settings, Raw YAML itself,
// Onboarding) render normally — Raw YAML must stay reachable so the
// operator can fix the syntax.
//
// Why a wrapper rather than a guard per page?
//   * DRY: seven pages would otherwise need to import + check the same
//     computed at their mount points.
//   * A single source of truth for the list of structural routes matters
//     for invariants — any future structural page added to the sidebar
//     inherits the block for free.

import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, ExternalLink } from 'lucide-vue-next'
import { useConfigStore } from '@/stores/config'
import { Button } from '@/components/ui/button'

const { t } = useI18n()
const config = useConfigStore()
const route = useRoute()

/** Route names that read/write structured sections of the draft. These are
 *  the ones that break if the YAML doesn't parse — every edit on these
 *  pages goes through `parseDraft(draftText)` which throws on bad YAML. */
const STRUCTURAL_ROUTES = new Set([
  'services',
  'service-detail',
  'proxies',
  'providers',
  'dns',
  'tun',
  'sniffer',
  'profile',
])

const isStructural = computed(() => {
  const name = route.name
  if (typeof name !== 'string') return false
  return STRUCTURAL_ROUTES.has(name)
})

const shouldBlock = computed(() => !config.draftValid && isStructural.value)
</script>

<template>
  <div v-if="shouldBlock" class="mx-auto max-w-3xl p-6" data-testid="yaml-invalid-banner">
    <div
      class="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-5"
      role="alert"
    >
      <AlertTriangle class="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
      <div class="flex-1 space-y-2">
        <h2 class="text-base font-semibold text-foreground">
          {{ t('raw_yaml.invalid_banner_title') }}
        </h2>
        <p class="text-sm text-muted-foreground">
          {{ t('raw_yaml.invalid_banner_body') }}
        </p>
        <p
          v-if="config.draftParseError"
          class="whitespace-pre-wrap font-mono text-xs text-destructive"
          data-testid="yaml-invalid-banner-detail"
        >
          <span v-if="config.draftParseError.line">
            {{
              t('raw_yaml.parse_error_line', {
                line: config.draftParseError.line,
                col: config.draftParseError.col ?? 1,
              })
            }}
          </span>
          {{ config.draftParseError.message }}
        </p>
        <div class="pt-2">
          <RouterLink to="/raw-yaml">
            <Button size="sm" variant="outline" data-testid="yaml-invalid-banner-link">
              <ExternalLink class="mr-1.5 h-3.5 w-3.5" />
              {{ t('raw_yaml.invalid_banner_link') }}
            </Button>
          </RouterLink>
        </div>
      </div>
    </div>
  </div>
  <slot v-else />
</template>
