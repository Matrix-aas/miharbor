<script setup lang="ts">
import { useI18n } from 'vue-i18n'
interface Props {
  /** i18n key prefix under `pages.*`, e.g. "pages.proxies". */
  pageKey: string
}
const props = defineProps<Props>()
const { t } = useI18n()
</script>

<template>
  <section class="space-y-2">
    <h1 class="text-2xl font-semibold tracking-tight">{{ t(`${props.pageKey}.title`) }}</h1>
    <p class="text-sm text-muted-foreground">{{ t(`${props.pageKey}.placeholder`) }}</p>
  </section>
</template>
