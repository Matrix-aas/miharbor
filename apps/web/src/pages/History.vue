<script setup lang="ts">
// Placeholder — real implementation below in commit "feat(web): History …".
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>
<template>
  <section class="space-y-2">
    <h1 class="text-2xl font-semibold tracking-tight">{{ t('pages.history.title') }}</h1>
    <p class="text-sm text-muted-foreground">{{ t('pages.history.placeholder') }}</p>
  </section>
</template>
