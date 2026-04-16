<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>
<template>
  <section class="space-y-2">
    <h1 class="text-2xl font-semibold tracking-tight">{{ t('pages.settings.title') }}</h1>
    <p class="text-sm text-muted-foreground">{{ t('pages.settings.placeholder') }}</p>
  </section>
</template>
