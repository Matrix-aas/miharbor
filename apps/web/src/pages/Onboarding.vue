<script setup lang="ts">
// Onboarding — rendered when no live mihomo config file exists.
// Single CTA: "Create minimal config" → POST /api/onboarding/seed →
// router-navigate to /services.
//
// No AppShell wraps this page (router meta: noShell=true). We render a
// full-bleed centered card so new operators aren't distracted by the
// sidebar / empty Services screen.

import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Loader2, Rocket, ServerOff } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { endpoints, ApiError } from '@/api/client'
import { useConfigStore } from '@/stores/config'

const { t } = useI18n()
const router = useRouter()
const config = useConfigStore()

const status = ref<'idle' | 'seeding' | 'done' | 'error'>('idle')
const errorMsg = ref<string | null>(null)
const configPath = ref<string>('')

// Kick off a status check — the router guard usually sets this already,
// but if someone navigates directly we still show the current path.
void endpoints.onboarding
  .status()
  .then((s) => {
    configPath.value = s.configPath
  })
  .catch(() => {
    /* ignore — we'll render a generic path */
  })

async function onCreate(): Promise<void> {
  status.value = 'seeding'
  errorMsg.value = null
  try {
    const r = await endpoints.onboarding.seed()
    configPath.value = r.path
    status.value = 'done'
    // Re-bootstrap the config store so /services has something to show.
    await config.loadAll()
    // Small delay so the user sees the success message, then navigate.
    setTimeout(() => {
      void router.replace({ name: 'services' })
    }, 600)
  } catch (e) {
    status.value = 'error'
    errorMsg.value = e instanceof ApiError ? e.message : (e as Error).message
  }
}
</script>

<template>
  <section class="flex min-h-screen items-center justify-center bg-background px-4">
    <div class="w-full max-w-xl space-y-6 rounded-xl border border-border bg-card/40 p-8 shadow-lg">
      <header class="flex items-center gap-3">
        <div
          class="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"
        >
          <ServerOff class="h-6 w-6" />
        </div>
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">{{ t('onboarding.title') }}</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            {{ t('onboarding.subtitle', { path: configPath || '…' }) }}
          </p>
        </div>
      </header>

      <p class="text-sm">{{ t('onboarding.question') }}</p>
      <p class="text-xs text-muted-foreground">{{ t('onboarding.about_seed') }}</p>

      <div class="flex items-center gap-3">
        <Button :disabled="status === 'seeding'" @click="onCreate">
          <Loader2 v-if="status === 'seeding'" class="mr-2 h-4 w-4 animate-spin" />
          <Rocket v-else class="mr-2 h-4 w-4" />
          {{ status === 'seeding' ? t('onboarding.creating') : t('onboarding.create') }}
        </Button>
        <p v-if="status === 'done'" class="text-xs text-emerald-500">
          {{ t('onboarding.created') }}
        </p>
      </div>

      <div
        v-if="status === 'error' && errorMsg"
        class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
      >
        {{ t('onboarding.failed', { error: errorMsg }) }}
      </div>
    </div>
  </section>
</template>
