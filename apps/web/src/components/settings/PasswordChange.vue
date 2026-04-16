<script setup lang="ts">
// Password change card — posts { oldPassword, newPassword } to
// /api/auth/password. Shows per-field validation + a success / error
// banner. The card never pre-fills any field; confirmation typed twice.

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { KeyRound, Loader2, ShieldCheck, ShieldAlert } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { endpoints, ApiError } from '@/api/client'

const { t } = useI18n()

const current = ref('')
const next = ref('')
const confirm = ref('')
const status = ref<'idle' | 'submitting' | 'ok' | 'error'>('idle')
const errorMsg = ref<string | null>(null)

const tooShort = computed(() => next.value.length > 0 && next.value.length < 8)
const mismatch = computed(() => confirm.value.length > 0 && confirm.value !== next.value)
const canSubmit = computed(
  () =>
    status.value !== 'submitting' &&
    current.value.length > 0 &&
    next.value.length >= 8 &&
    confirm.value === next.value,
)

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  status.value = 'submitting'
  errorMsg.value = null
  try {
    await endpoints.auth.password(current.value, next.value)
    status.value = 'ok'
    current.value = ''
    next.value = ''
    confirm.value = ''
  } catch (e) {
    status.value = 'error'
    if (e instanceof ApiError) {
      if (e.status === 401 || e.body?.code === 'WRONG_OLD_PASSWORD') {
        errorMsg.value = t('settings.password_wrong_current')
      } else if (e.body?.code === 'BAD_PASSWORD') {
        errorMsg.value = e.body.message ?? t('settings.password_too_short')
      } else {
        errorMsg.value = e.message
      }
    } else {
      errorMsg.value = (e as Error).message
    }
  }
}
</script>

<template>
  <section class="space-y-4 rounded-md border border-border bg-card/30 p-5">
    <header class="flex items-center gap-2">
      <KeyRound class="h-5 w-5 text-muted-foreground" />
      <h2 class="text-lg font-semibold">{{ t('settings.password_title') }}</h2>
    </header>

    <form class="space-y-3" @submit.prevent="submit">
      <div>
        <label class="mb-1 block text-xs font-medium text-muted-foreground">
          {{ t('settings.password_current') }}
        </label>
        <Input v-model="current" type="password" autocomplete="current-password" />
      </div>
      <div>
        <label class="mb-1 block text-xs font-medium text-muted-foreground">
          {{ t('settings.password_new') }}
        </label>
        <Input v-model="next" type="password" autocomplete="new-password" />
        <p v-if="tooShort" class="mt-1 text-xs text-destructive">
          {{ t('settings.password_too_short') }}
        </p>
      </div>
      <div>
        <label class="mb-1 block text-xs font-medium text-muted-foreground">
          {{ t('settings.password_confirm') }}
        </label>
        <Input v-model="confirm" type="password" autocomplete="new-password" />
        <p v-if="mismatch" class="mt-1 text-xs text-destructive">
          {{ t('settings.password_mismatch') }}
        </p>
      </div>

      <div class="flex items-center gap-3">
        <Button type="submit" :disabled="!canSubmit">
          <Loader2 v-if="status === 'submitting'" class="mr-1.5 h-3.5 w-3.5 animate-spin" />
          {{ t('settings.password_submit') }}
        </Button>
        <p v-if="status === 'ok'" class="flex items-center gap-1.5 text-xs text-emerald-500">
          <ShieldCheck class="h-4 w-4" />
          {{ t('settings.password_success') }}
        </p>
        <p
          v-else-if="status === 'error'"
          class="flex items-center gap-1.5 text-xs text-destructive"
        >
          <ShieldAlert class="h-4 w-4" />
          {{ errorMsg }}
        </p>
      </div>
    </form>
  </section>
</template>
