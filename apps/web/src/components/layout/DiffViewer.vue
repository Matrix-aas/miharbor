<script setup lang="ts">
// Placeholder diff viewer. Monaco diff editor arrives in a later task
// (Raw YAML + Services). For now we accept a pair of strings and render a
// <pre>-tag dump so other screens can integrate against the same shape.

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

interface Props {
  before?: string | null
  after?: string | null
}
const props = withDefaults(defineProps<Props>(), { before: '', after: '' })
const { t } = useI18n()

const preview = computed(() => {
  if (!props.before && !props.after) return t('diff.placeholder')
  return `--- live\n+++ draft\n${props.before ?? ''}\n---\n${props.after ?? ''}`
})
</script>

<template>
  <div class="space-y-2">
    <h2 class="text-sm font-semibold">{{ t('diff.title') }}</h2>
    <pre
      class="overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs leading-snug"
      >{{ preview }}</pre
    >
  </div>
</template>
