<script setup lang="ts">
// Settings page — Task 25.
// Three cards stacked vertically: password change, env readonly, LLM-keys
// placeholder. The env card is populated from GET /api/settings/env with
// secrets masked server-side.

import { useI18n } from 'vue-i18n'
import PasswordChange from '@/components/settings/PasswordChange.vue'
import EnvReadonly from '@/components/settings/EnvReadonly.vue'
import LlmKeys from '@/components/settings/LlmKeys.vue'

const { t } = useI18n()
</script>

<template>
  <section class="space-y-6 px-4 py-6 md:px-6">
    <header>
      <h1 class="text-2xl font-semibold tracking-tight">{{ t('settings.title') }}</h1>
    </header>
    <PasswordChange />
    <EnvReadonly />
    <LlmKeys />
  </section>
</template>
